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
setGlobalOptions({ maxInstances: 10 });

// Secrets
const pineconeApiKey = defineSecret("PINECONE_API_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// --- PINECONE CONNECTION TEST ---
exports.checkPineconeConnection = onRequest(
  { secrets: [pineconeApiKey] }, 
  async (req, res) => {
    try {
      const rawValue = pineconeApiKey.value().trim();
      const pc = new Pinecone({ apiKey: rawValue });
      const indexList = await pc.listIndexes();
      
      res.status(200).send({
        status: "success",
        message: "MergePoint is officially connected!",
        indexes: indexList.indexes,
      });
    } catch (error) {
      console.error("Connection Debug:", error.message);
      res.status(500).send({ status: "error", details: error.message });
    }
  }
);

// --- GEMINI TENDER ANALYSIS ---
exports.analyzeTenderDocument = onCall(
  { secrets: [geminiApiKey] }, 
  async (request) => {
    if (!request.auth) {
      throw new Error("Unauthorized: You must be logged in.");
    }

    const { bidId, documentUrl, fileName } = request.data;
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const prompt = `
        You are a professional Bid Manager. I am providing you with a tender document named "${fileName}".
        Please extract every specific question or section that requires a written response.
        
        Return ONLY a JSON array of objects with this structure:
        [
            {"question": "Text of the question", "status": "ready", "aiResponse": "", "confidence": 100},
            {"question": "Vague question...", "status": "attention", "aiResponse": "", "confidence": 100}
        ]
        Set status to "attention" if the question is unclear. Do not include any text other than the JSON.
      `;

      const result = await model.generateContent([prompt, `Document Link: ${documentUrl}`]);
      const responseText = result.response.text();
      
      const jsonMatch = responseText.match(/\[.*\]/s);
      const sections = JSON.parse(jsonMatch[0]);

      const db = getFirestore("default"); 
      await db.collection("bids").doc(bidId).set({
        sections: sections,
        status: "scoping",
        analysisCompletedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return { success: true, count: sections.length };
    } catch (error) {
      console.error("AI Analysis Error:", error);
      return { success: false, error: error.message };
    }
  }
);

// --- RAG-ENABLED SECTION DRAFTER ---
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] }, 
  async (request) => {
    if (!request.auth) {
      throw new Error("Unauthorized: You must be logged in.");
    }

    const { question, bidId } = request.data;
    const userId = request.auth.uid;
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const queryEmbedding = await embeddingModel.embedContent(question);
      
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const queryResponse = await index.query({
        vector: queryEmbedding.embedding.values.slice(0, 768),
        topK: 3,
        filter: { ownerId: userId },
        includeMetadata: true
      });

      const contextText = queryResponse.matches
        .map(match => match.metadata.text)
        .join("\n\n---\n\n");

      const prompt = `
        You are an expert Bid Writer. Draft a professional response to the tender question below using the provided COMPANY CONTEXT.
        
        QUESTION: "${question}"
        
        COMPANY CONTEXT:
        ${contextText || "No specific company documents found."}
        
        INSTRUCTIONS:
        - Use a professional, persuasive, and confident tone.
        - Return ONLY the text of the drafted response.
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      return { 
        success: true, 
        answer: responseText,
        confidence: contextText ? 95 : 75,
        contextFound: queryResponse.matches.length > 0
      };

    } catch (error) {
      console.error("Drafting Error:", error);
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
    const fileName = pathParts[pathParts.length - 1];
    const userId = pathParts[pathParts.length - 2] || "unknown_user";

    try {
      const tempFilePath = path.join("/tmp", fileName);
      await bucket.file(filePath).download({ destination: tempFilePath });
      const dataBuffer = fs.readFileSync(tempFilePath);

      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1); 
      const fullText = await new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
        pdfParser.parseBuffer(dataBuffer);
      });

      const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const vectors = await Promise.all(chunks.map(async (chunk, i) => {
        const result = await embeddingModel.embedContent(chunk);
        return {
          id: `${userId}_${Date.now()}_${i}`,
          values: result.embedding.values.slice(0, 768),
          metadata: { text: chunk, ownerId: userId, source: fileName }
        };
      }));

      await index.upsert(vectors);

      const db = getFirestore("default");
      const snap = await db.collection("knowledge").where("ownerId", "==", userId).get();
      const docToUpdate = snap.docs.find(doc => fileName.includes(doc.data().fileName));

      if (docToUpdate) {
        await docToUpdate.ref.update({ status: "ready" });
      }

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch (error) {
      console.error("CRITICAL ERROR in processMasterDocument:", error.message);
    }
  }
);

// --- KNOWLEDGE BASE DELETE SYNC (STORAGE + PINECONE) ---
exports.cleanupKnowledgeBase = onDocumentDeleted({
  document: "knowledge/{docId}",
  database: "default",      
  region: "europe-west2",   
  secrets: [pineconeApiKey] 
}, async (event) => {
  console.log("!!! TRIGGER ACTIVATED !!! Doc ID:", event.params.docId);

  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  const fileName = data?.fileName;
  const userId = data?.ownerId;

  if (!fileName || !userId) return;

  try {
    // --- STEP 1: DELETE FROM STORAGE ---
    const bucket = admin.storage().bucket();
    // We try both paths because some uploads use the v1_ prefix
    const possiblePaths = [
      `knowledge/${userId}/${fileName}`,
      `knowledge/${userId}/v1_${fileName}`
    ];

    for (const storagePath of possiblePaths) {
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (exists) {
        console.log(`Deleting file from Storage: ${storagePath}`);
        await file.delete();
      }
    }

    // --- STEP 2: DELETE FROM PINECONE ---
    const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
    const index = pc.index("mergepoint-index");

    console.log(`Step 2: Fetching IDs for ${fileName} (User: ${userId})...`);

    const queryResponse = await index.query({
      vector: Array(768).fill(0), 
      filter: {
        ownerId: userId,
        source: { "$in": [fileName, `v1_${fileName}`] }
      },
      topK: 1000,
      includeMetadata: false
    });

    const idsToDelete = queryResponse.matches.map(m => m.id);

    if (idsToDelete.length > 0) {
      console.log(`Step 3: Deleting ${idsToDelete.length} vectors...`);
      await index.deleteMany(idsToDelete);
      console.log(`SUCCESS: Storage and Pinecone cleared.`);
    } else {
      console.log("Storage checked, but no matching vectors found in Pinecone.");
    }

  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
  }
});