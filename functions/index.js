/* eslint-disable */
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
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

// --- GEMINI TENDER ANALYSIS (ANTI-HALLUCINATION) ---
exports.analyzeTenderDocument = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, memory: "2GiB" }, 
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized: You must be logged in.");
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

      // Unified Prompt: Verbatim extraction + status flagging
      const prompt = `
        You are a professional Bid Manager. I am providing you with a tender document.
        Extract every specific question or section that requires a written response.
        
        RULES:
        1. Capture items exactly as they appear (Verbatim).
        2. Set status to "attention" if the requirement is vague or unclear.
        3. Set status to "ready" for clear questions.
        
        Return ONLY a JSON array of objects:
        [{"sectionTitle": "Heading", "question": "Requirement Text", "status": "ready/attention", "aiResponse": "", "confidence": 100}]
        
        TEXT: ${tenderText.substring(0, 35000)}
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const jsonMatch = responseText.match(/\[\s*{[\s\S]*}\s*\]|\[\s*\]/);
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

// --- RAG SECTION DRAFTER (PRIORITY & CONTEXT AWARE) ---
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] }, 
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");
    const { question, bidId, sectionIndex } = request.data;
    const userId = request.auth.uid;
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const embedding = await embedModel.embedContent(question);
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const queryResponse = await index.query({
        vector: embedding.embedding.values.slice(0, 768),
        topK: 8,
        filter: { ownerId: userId },
        includeMetadata: true
      });

      const contextText = queryResponse.matches.map(m => {
        const cat = (m.metadata.category || "master").toUpperCase();
        const prio = m.metadata.priority || 1;
        return `[Source: ${cat} | Priority: ${prio}]\n${m.metadata.text}`;
      }).join("\n\n---\n\n");

      // Unified Prompt: Professional Bid Writer tone + Priority Logic
      const prompt = `
        You are an expert Bid Writer. Draft a professional response to the tender question below using the provided COMPANY CONTEXT.
        
        QUESTION: "${question}"
        
        COMPANY CONTEXT:
        ${contextText || "No specific company documents found."}
        
        INSTRUCTIONS:
        1. Use a professional, persuasive, and confident tone.
        2. CONFLICT RESOLUTION: If information from a high priority (e.g. Priority 5) source conflicts with a lower one, use the higher priority info.
        3. Return ONLY the text of the drafted response.
      `;

      const result = await model.generateContent(prompt);
      const answerText = result.response.text();

      if (bidId && sectionIndex !== undefined) {
        const bidRef = getDb().collection("bids").doc(bidId);
        const bidDoc = await bidRef.get();
        if (bidDoc.exists) {
            const sections = bidDoc.data().sections || [];
            if (sections[sectionIndex]) {
                sections[sectionIndex].draftAnswer = answerText;
                await bidRef.update({ sections: sections });
            }
        }
      }
      return { 
        success: true, 
        answer: answerText,
        confidence: contextText ? 95 : 75,
        contextFound: queryResponse.matches.length > 0
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
);

// --- KNOWLEDGE BASE SYNC (UPLOAD) ---
exports.processMasterDocument = onObjectFinalized(
  { region: "us-east1", secrets: [geminiApiKey, pineconeApiKey], timeoutSeconds: 300, memory: "1GiB" },
  async (event) => {
    const filePath = event.data.name; 
    if (!filePath.toLowerCase().includes("knowledge/") || !filePath.toLowerCase().endsWith(".pdf")) return;

    const bucket = admin.storage().bucket(event.data.bucket);
    const pathParts = filePath.split("/");
    const fileName = pathParts.at(-1);
    const userId = pathParts.at(-2);

    try {
      const db = getDb();
      const snap = await db.collection("knowledge").where("ownerId", "==", userId).get();
      const metaDoc = snap.docs.find(doc => fileName.includes(doc.data().fileName));
      
      const category = metaDoc?.data()?.category || "master";
      const priority = metaDoc?.data()?.priority || 1;

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
        const result = await embedModel.embedContent(chunk);
        return {
          id: `${userId}_${Date.now()}_${i}`,
          values: result.embedding.values.slice(0, 768),
          metadata: { 
            text: chunk, 
            ownerId: userId, 
            source: fileName,
            category: category,
            priority: priority
          }
        };
      }));

      await index.upsert(vectors);
      if (metaDoc) await metaDoc.ref.update({ status: "ready" });
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

  if (!fileName || !userId) return;

  try {
    const bucket = admin.storage().bucket();
    const possiblePaths = [
      `knowledge/${userId}/${fileName}`,
      `knowledge/${userId}/v1_${fileName}`
    ];

    for (const storagePath of possiblePaths) {
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (exists) {
        await file.delete();
        console.log(`Deleted file: ${storagePath}`);
      }
    }

    const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
    const index = pc.index("mergepoint-index");

    const queryResponse = await index.query({
      vector: Array(768).fill(0), 
      filter: {
        ownerId: userId,
        source: { "$in": [fileName, `v1_${fileName}`] }
      },
      topK: 1000,
      includeMetadata: false
    });

    const ids = queryResponse.matches.map(m => m.id);
    if (ids.length > 0) {
        await index.deleteMany(ids);
        console.log(`Cleaned up ${ids.length} vectors for ${fileName}`);
    }
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
  }
});