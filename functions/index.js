/* eslint-disable */
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const { initializeFirestore, getFirestore } = require("firebase-admin/firestore");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const path = require("path");
const fs = require("fs");

admin.initializeApp();

setGlobalOptions({ 
    region: "us-east1",
    maxInstances: 10 
});

const getDb = () => getFirestore('default');

const pineconeApiKey = defineSecret("PINECONE_API_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// --- PINECONE CONNECTION TEST ---
exports.checkPineconeConnection = onRequest(
  { secrets: [pineconeApiKey] }, 
  async (req, res) => {
    try {
      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      const indexList = await pc.listIndexes();
      res.status(200).send({ status: "success", indexes: indexList.indexes });
    } catch (error) {
      res.status(500).send({ status: "error", details: error.message });
    }
  }
);

// --- GEMINI TENDER ANALYSIS ---
exports.analyzeTenderDocument = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, memory: "2GiB" }, 
  async (request) => {
    const { bidId, fileName } = request.data;
    const tempFilePath = path.join("/tmp", `tender_${Date.now()}.pdf`);

    try {
      const bucket = admin.storage().bucket();
      const storagePath = `tenders/${request.auth.uid}/${fileName}`;
      await bucket.file(storagePath).download({ destination: tempFilePath });

      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1);
      const tenderText = await new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
        pdfParser.on("pdfParser_dataError", (err) => reject(err));
        pdfParser.parseBuffer(fs.readFileSync(tempFilePath));
      });

      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 4096 }
      });

      const prompt = `
        You are a Precise Tender Parser. Extract every requirement and assign to correct headings.
        RULES: 
        1. Capture all list items and bullet points.
        2. Identify specific technical/compliance requirements.
        3. Copy text exactly (Verbatim).
        OUTPUT FORMAT (JSON):
        [{"sectionTitle": "Heading", "question": "Requirement Text", "sourceQuote": "Full Line"}]
        
        TEXT: ${tenderText.substring(0, 35000)}
      `;

      const result = await model.generateContent(prompt);
      const jsonMatch = result.response.text().match(/\[\s*{[\s\S]*}\s*\]|\[\s*\]/);
      const sections = JSON.parse(jsonMatch[0]);

      await getDb().collection("bids").doc(bidId).update({
        sections: sections,
        status: "scoping",
        extractedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, count: sections.length };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
  }
);

// --- RAG SECTION DRAFTER (SMOOTH SCORING VERSION) ---
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] }, 
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");
    const { question, bidId, sectionIndex } = request.data;
    const userId = request.auth.uid;
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { temperature: 0.2 } });

      const embedding = await embedModel.embedContent(question);
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const queryResponse = await index.query({
        vector: embedding.embedding.values.slice(0, 768),
        topK: 6,
        filter: { ownerId: userId },
        includeMetadata: true
      });

      const topMatch = queryResponse.matches.length > 0 ? queryResponse.matches[0] : null;
      const rawVectorScore = topMatch ? topMatch.score : 0;
      const contextText = queryResponse.matches.map(m => m.metadata.text).join("\n\n---\n\n");

      // --- CRITICAL AI EVALUATION ---
      const evalPrompt = `
        Requirement: "${question}"
        Available Knowledge: "${contextText || "No context found."}"
        
        Evaluate the relevancy of the knowledge base to the requirement.
        - 10: Direct, explicit answer found.
        - 8: Strong information that fully covers the intent.
        - 5: Partial information; some drafting needed.
        - 2: Very weak or only tangentially related.
        - 0: Completely unrelated.

        Return ONLY the number.
      `;

      const evalResult = await model.generateContent(evalPrompt);
      const aiRating = parseFloat(evalResult.response.text().trim()) || 0;

      // --- DYNAMIC SCORING (NO HARD FLOORS) ---
      // Vector score normalized (0.6 to 0.9 is the sweet spot)
      const vectorConfidence = Math.min(Math.max((rawVectorScore - 0.1) / 0.8 * 100, 0), 100);
      const aiConfidence = (aiRating / 10) * 100;
      
      // Calculate a weighted average
      let finalConfidence = Math.round((aiConfidence * 0.7) + (vectorConfidence * 0.3));

      // Apply a logical minimum if context was actually found
      if (queryResponse.matches.length > 0) {
        finalConfidence = Math.max(finalConfidence, 12);
      }

      const safeConfidence = Math.min(finalConfidence, 98);

      const prompt = `
        Draft a focused, professional tender response to ONLY the following requirement:
        "${question}"

        Using ONLY this context:
        ${contextText || "No relevant company information found."}
        
        INSTRUCTIONS:
        1. Professional and persuasive tone.
        2. DO NOT draft other sections.
        3. If context is missing, focus on the firm's general expertise while keeping the tone professional.
      `;

      const result = await model.generateContent(prompt);
      const answerText = result.response.text();

      // --- PERSISTENCE ---
      if (bidId && sectionIndex !== undefined) {
        const bidRef = getDb().collection("bids").doc(bidId);
        const bidDoc = await bidRef.get();
        if (bidDoc.exists) {
            const sections = bidDoc.data().sections || [];
            if (sections[sectionIndex]) {
                sections[sectionIndex].draftAnswer = answerText;
                sections[sectionIndex].confidence = safeConfidence;
                sections[sectionIndex].lastDraftedAt = new Date().toISOString();
                await bidRef.update({ sections: sections });
            }
        }
      }
      
      return { 
        success: true, 
        answer: answerText, 
        confidence: safeConfidence,
        contextFound: queryResponse.matches.length > 0 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
);

// --- KNOWLEDGE BASE SYNC ---
exports.processMasterDocument = onObjectFinalized(
  { region: "us-east1", secrets: [geminiApiKey, pineconeApiKey], timeoutSeconds: 300, memory: "1GiB" },
  async (event) => {
    const filePath = event.data.name; 
    if (!filePath.toLowerCase().includes("knowledge/") || !filePath.toLowerCase().endsWith(".pdf")) return;

    const bucket = admin.storage().bucket(event.data.bucket);
    const parts = filePath.split("/");
    const fileName = parts.at(-1);
    const userId = parts.at(-2);

    try {
      const tempFilePath = path.join("/tmp", fileName);
      await bucket.file(filePath).download({ destination: tempFilePath });
      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1); 
      const fullText = await new Promise((resolve) => {
        pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
        pdfParser.parseBuffer(fs.readFileSync(tempFilePath));
      });

      const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const vectors = await Promise.all(chunks.map(async (chunk, i) => {
        const emb = await embedModel.embedContent(chunk);
        return {
          id: `${userId}_${Date.now()}_${i}`,
          values: emb.embedding.values.slice(0, 768),
          metadata: { text: chunk, ownerId: userId, source: fileName }
        };
      }));

      await index.upsert(vectors);

      const db = getDb();
      const snap = await db.collection("knowledge").where("ownerId", "==", userId).get();
      const docToUpdate = snap.docs.find(doc => fileName.includes(doc.data().fileName));
      if (docToUpdate) await docToUpdate.ref.update({ status: "ready" });

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch (error) {
      console.error("INGESTION ERROR:", error.message);
    }
  }
);

// --- KNOWLEDGE BASE DELETE SYNC ---
exports.cleanupKnowledgeBase = onDocumentDeleted({
  document: "knowledge/{docId}",
  database: "default",      
  region: "europe-west2",   
  secrets: [pineconeApiKey] 
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const data = snapshot.data();
  const fileName = data?.fileName;
  const userId = data?.ownerId;

  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(`knowledge/${userId}/${fileName}`);
    const [exists] = await file.exists();
    if (exists) await file.delete();

    const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
    const index = pc.index("mergepoint-index");
    const queryResponse = await index.query({
      vector: Array(768).fill(0), 
      filter: { ownerId: userId, source: fileName },
      topK: 1000
    });

    const ids = queryResponse.matches.map(m => m.id);
    if (ids.length > 0) await index.deleteMany(ids);
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
  }
});