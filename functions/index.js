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

// STABLE: Keep your explicit Europe DB routing
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

// --- GEMINI TENDER ANALYSIS (STRICT VERSION) ---
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
      // IMPROVEMENT: Set temperature to 0 to stop hallucinations
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 4096,
        }
      });

      const prompt = `
       You are a Precise Tender Parser.
        
        TASK:
        Exhaustively extract every requirement, deliverable, or question found in this document.
        
        STRICT HIERARCHY RULES:
        1. IDENTIFY SECTIONS: Look for headings (e.g., "1. Project Background", "2. Digital Requirements"). Assign every requirement to the heading it falls under.
        2. CAPTURE ALL LIST ITEMS: Any text preceded by a bullet point (•), a letter (a, b, c), or a code (DR-01, etc.) MUST be extracted.
        3. CAPTURE ALL INSTRUCTIONS: Any sentence that specifies a capability the solution "must" have or an action the bidder "must" take is a requirement.
        4. NO SELECTIVITY: Do not judge if a requirement is important. If it is in the text, it must be in the JSON.
        5. VERBATIM: Do not reword. Copy text exactly.

        OUTPUT FORMAT (JSON ONLY):
        [
          {
            "sectionTitle": "The current heading name (e.g. 2. Digital Requirements)",
            "question": "The exact requirement text",
            "sourceQuote": "The full line from the PDF"
          }
        ]

        DOCUMENT TEXT:
        ${tenderText.substring(0, 35000)}
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
      console.error("ANALYSIS ERROR:", error);
      return { success: false, error: error.message };
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
  }
);

// --- RAG-ENABLED SECTION DRAFTER ---
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] }, 
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");
    const { question } = request.data;
    const userId = request.auth.uid;
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { temperature: 0.3 } });

      const embedding = await embedModel.embedContent(question);
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const queryResponse = await index.query({
        vector: embedding.embedding.values.slice(0, 768),
        topK: 4,
        filter: { ownerId: userId },
        includeMetadata: true
      });

      const contextText = queryResponse.matches.map(m => m.metadata.text).join("\n\n---\n\n");

      const prompt = `
        Draft a response to: "${question}"
        Using ONLY this context:
        ${contextText || "No context found."}
        
        Tone: Professional and persuasive.
      `;

      const result = await model.generateContent(prompt);
      return { success: true, answer: result.response.text(), contextFound: queryResponse.matches.length > 0 };
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

// --- KNOWLEDGE BASE DELETE SYNC (STABLE: DON'T REMOVE THIS) ---
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
    console.log("Cleanup successful");
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
  }
});