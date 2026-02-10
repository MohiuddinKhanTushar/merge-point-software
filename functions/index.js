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
const PDFParser = require("pdf2json");

admin.initializeApp();

setGlobalOptions({
  region: "us-east1",
  maxInstances: 10
});

const getDb = () => getFirestore("default");
const pineconeApiKey = defineSecret("PINECONE_API_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");

const PINECONE_INDEX = "mergepoint-index";

/* ------------------ UTIL ------------------ */
const getNamespaceForDoc = (ownerId, docId) =>
  `kb_${ownerId}_${docId}`;

/* ------------------ PINECONE TEST (KEPT) ------------------ */
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

/* ------------------ NEW: TENDER ANALYSIS ------------------ */
exports.analyzeTenderDocument = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, memory: "2GiB" },
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");
    const { bidId, fileName } = request.data;
    const userId = request.auth.uid;

    try {
      const bucket = admin.storage().bucket();
      const storagePath = `tenders/${userId}/${fileName}`;
      const tempFilePath = path.join("/tmp", `tender_${Date.now()}.pdf`);
      
      await bucket.file(storagePath).download({ destination: tempFilePath });
      
      const pdfParser = new PDFParser(null, 1);
      const tenderText = await new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
        pdfParser.on("pdfParser_dataError", reject);
        pdfParser.parseBuffer(fs.readFileSync(tempFilePath));
      });

      const genAI = new GoogleGenerativeAI(geminiApiKey.value().trim());
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const prompt = `
        Analyze this tender document. Extract specific questions/requirements.
        Return ONLY a JSON array: [{"sectionTitle": "...", "question": "...", "status": "empty", "aiResponse": "", "confidence": 0}]
        TEXT: ${tenderText.substring(0, 40000)}
      `;

      const result = await model.generateContent(prompt);
      const sections = JSON.parse(result.response.text().match(/\[[\s\S]*\]/)[0]);

      await getDb().collection("bids").doc(bidId).update({
        sections: sections,
        status: "scoping"
      });

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      return { success: true };
    } catch (error) {
      console.error("ANALYSIS ERROR:", error);
      return { success: false, error: error.message };
    }
  }
);

/* ------------------ RAG SECTION DRAFTER ------------------ */
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] },
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");
    const { question } = request.data;
    const userId = request.auth.uid;

    try {
      const db = getDb();
      const genAI = new GoogleGenerativeAI(geminiApiKey.value().trim());
      const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const embedResult = await embedModel.embedContent({
        content: { parts: [{ text: question }] },
        outputDimensionality: 768
      });

      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      const index = pc.index(PINECONE_INDEX);

      const snap = await db.collection("knowledge")
        .where("ownerId", "==", userId)
        .where("excludeFromAI", "==", false).get();

      const queries = snap.docs.map(doc => {
        const ns = getNamespaceForDoc(userId, doc.id);
        return index.namespace(ns).query({
          vector: embedResult.embedding.values,
          topK: 5,
          includeMetadata: true
        });
      });

      const results = (await Promise.all(queries))
        .flatMap(r => r.matches || [])
        .sort((a, b) => b.score - a.score).slice(0, 8);

      const contextText = results.map(m => `[Source: ${m.metadata.category}]\n${m.metadata.text}`).join("\n\n");
      const prompt = `QUESTION: "${question}"\n\nCONTEXT:\n${contextText}\n\nWrite a professional response.`;
      const resultGen = await model.generateContent(prompt);
      return { success: true, answer: resultGen.response.text() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
);

/* ------------------ KNOWLEDGE BASE INGEST ------------------ */
exports.processMasterDocument = onObjectFinalized(
  { region: "us-east1", secrets: [geminiApiKey, pineconeApiKey], timeoutSeconds: 300, memory: "1GiB" },
  async (event) => {
    const filePath = event.data.name;
    if (!filePath?.toLowerCase().includes("knowledge/")) return;
    const bucket = admin.storage().bucket(event.data.bucket);
    const userId = filePath.split("/").at(-2);

    try {
      const db = getDb();
      const snap = await db.collection("knowledge").where("ownerId", "==", userId).get();
      const metaDoc = snap.docs.find(d => d.data().storagePath === filePath);
      if (!metaDoc || metaDoc.data().excludeFromAI) return;

      const namespace = getNamespaceForDoc(userId, metaDoc.id);
      const tempFilePath = path.join("/tmp", `ingest_${Date.now()}.pdf`);
      await bucket.file(filePath).download({ destination: tempFilePath });

      const pdfParser = new PDFParser(null, 1);
      const fullText = await new Promise((resolve) => {
        pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
        pdfParser.parseBuffer(fs.readFileSync(tempFilePath));
      });

      const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
      const genAI = new GoogleGenerativeAI(geminiApiKey.value().trim());
      const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      const index = pc.index(PINECONE_INDEX).namespace(namespace);

      const vectors = await Promise.all(chunks.map(async (chunk, i) => {
        const res = await embedModel.embedContent({ content: { parts: [{ text: chunk }] }, outputDimensionality: 768 });
        return { id: `${metaDoc.id}_${i}`, values: res.embedding.values, metadata: { text: chunk, category: metaDoc.data().category || "master" }};
      }));

      await index.upsert(vectors);
      await metaDoc.ref.update({ status: "ready", vectorizedAt: admin.firestore.FieldValue.serverTimestamp() });
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch (error) { console.error(error); }
  }
);

/* ------------------ KNOWLEDGE BASE DELETE ------------------ */
exports.cleanupKnowledgeBase = onDocumentDeleted(
  { document: "knowledge/{docId}", database: "default", region: "europe-west2", secrets: [pineconeApiKey] },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(data.storagePath);
      if ((await file.exists())[0]) await file.delete();
    } catch (e) {}
    if (!data.excludeFromAI) {
      try {
        const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
        await pc.index(PINECONE_INDEX).namespace(getNamespaceForDoc(data.ownerId, event.params.docId)).deleteAll();
      } catch (e) {}
    }
  }
);