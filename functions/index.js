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

/* ------------------ PINECONE TEST ------------------ */
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

      const embedding = embedResult.embedding.values;

      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      const index = pc.index(PINECONE_INDEX);

      // Fetch all active knowledge docs
      const snap = await db
        .collection("knowledge")
        .where("ownerId", "==", userId)
        .where("excludeFromAI", "==", false)
        .get();

      const queries = snap.docs.map(doc => {
        const ns = getNamespaceForDoc(userId, doc.id);
        return index.namespace(ns).query({
          vector: embedding,
          topK: 5,
          includeMetadata: true
        });
      });

      const results = (await Promise.all(queries))
        .flatMap(r => r.matches || [])
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      const contextText = results.map(m => {
        const cat = (m.metadata.category || "master").toUpperCase();
        return `[Source: ${cat}]\n${m.metadata.text}`;
      }).join("\n\n---\n\n");

      const prompt = `
You are an expert bid writer.

QUESTION:
"${question}"

CONTEXT:
${contextText || "No relevant context."}

Write a professional, compliant response.
`;

      const resultGen = await model.generateContent(prompt);
      return { success: true, answer: resultGen.response.text() };

    } catch (error) {
      console.error("DRAFT ERROR:", error.stack);
      return { success: false, error: error.message };
    }
  }
);

/* ------------------ KNOWLEDGE BASE INGEST ------------------ */
exports.processMasterDocument = onObjectFinalized(
  {
    region: "us-east1",
    secrets: [geminiApiKey, pineconeApiKey],
    timeoutSeconds: 300,
    memory: "1GiB"
  },
  async (event) => {
    const filePath = event.data.name;
    if (!filePath?.toLowerCase().includes("knowledge/")) return;

    const bucket = admin.storage().bucket(event.data.bucket);
    const pathParts = filePath.split("/");
    const userId = pathParts.at(-2);
    const fileName = pathParts.at(-1);

    try {
      const db = getDb();
      await new Promise(r => setTimeout(r, 3000));

      const snap = await db
        .collection("knowledge")
        .where("ownerId", "==", userId)
        .get();

      const metaDoc = snap.docs.find(d =>
        d.data().storagePath === filePath || d.data().fileName === fileName
      );

      if (!metaDoc) return;

      const metaData = metaDoc.data();
      if (metaData.excludeFromAI === true) {
        await metaDoc.ref.update({ status: "ready" });
        return;
      }

      const namespace = getNamespaceForDoc(userId, metaDoc.id);

      const tempFilePath = path.join("/tmp", `ingest_${Date.now()}.pdf`);
      await bucket.file(filePath).download({ destination: tempFilePath });

      const pdfParser = new PDFParser(null, 1);
      const fullText = await new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataReady", () =>
          resolve(pdfParser.getRawTextContent())
        );
        pdfParser.on("pdfParser_dataError", reject);
        pdfParser.parseBuffer(fs.readFileSync(tempFilePath));
      });

      const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
      const genAI = new GoogleGenerativeAI(geminiApiKey.value().trim());
      const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      const index = pc.index(PINECONE_INDEX).namespace(namespace);

      const vectors = await Promise.all(
        chunks.map(async (chunk, i) => {
          const result = await embedModel.embedContent({
            content: { parts: [{ text: chunk }] },
            outputDimensionality: 768
          });

          return {
            id: `${metaDoc.id}_${i}`,
            values: result.embedding.values,
            metadata: {
              text: chunk,
              category: metaData.category || "master"
            }
          };
        })
      );

      await index.upsert(vectors);
      await metaDoc.ref.update({
        status: "ready",
        vectorizedAt: admin.firestore.FieldValue.serverTimestamp(),
        pineconeNamespace: namespace
      });

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      console.log(`Ingested ${vectors.length} vectors into ${namespace}`);

    } catch (error) {
      console.error("INGEST ERROR:", error.stack);
    }
  }
);

/* ------------------ KNOWLEDGE BASE DELETE ------------------ */
exports.cleanupKnowledgeBase = onDocumentDeleted(
  {
    document: "knowledge/{docId}",
    database: "default",
    region: "europe-west2",
    secrets: [pineconeApiKey]
  },
  async (event) => {
    const data = event.data?.data();   // ✅ FIX
    const docId = event.params.docId;

    if (!data) {
      console.error("Cleanup aborted: no document data");
      return;
    }

    const { ownerId, storagePath, fileName, excludeFromAI } = data;

    console.log(`KB delete triggered for doc ${docId}, user ${ownerId}`);

    /* -------- Storage cleanup -------- */
    try {
      const bucket = admin.storage().bucket();
      const pathToDelete = storagePath || `knowledge/${ownerId}/${fileName}`;
      const file = bucket.file(pathToDelete);
      const [exists] = await file.exists();

      if (exists) {
        await file.delete();
        console.log(`Storage file deleted: ${pathToDelete}`);
      }
    } catch (err) {
      console.error("Storage cleanup error:", err.message);
    }

    /* -------- Pinecone cleanup -------- */
    if (excludeFromAI !== true && ownerId) {
      try {
        const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
        const namespace = getNamespaceForDoc(ownerId, docId);

        await pc
          .index(PINECONE_INDEX)
          .namespace(namespace)
          .deleteAll();

        console.log(`Pinecone namespace deleted: ${namespace}`);
      } catch (err) {
        console.error("Pinecone cleanup error:", err.stack);
      }
    }
  }
);
