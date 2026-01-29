/* eslint-disable */
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const { onObjectFinalized } = require("firebase-functions/v2/storage");
const path = require("path");
const fs = require("fs");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

// Secrets
const pineconeApiKey = defineSecret("PINECONE_API_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// --- EXISTING PINECONE TEST ---
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

// --- NEW GEMINI TENDER ANALYSIS ---
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

// --- UPDATED RAG-ENABLED SECTION DRAFTER ---
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

      // 1. Convert question to vector
      const queryEmbedding = await embeddingModel.embedContent(question);
      
      // 2. Query Pinecone for the top 3 relevant chunks
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      const queryResponse = await index.query({
        vector: queryEmbedding.embedding.values,
        topK: 3,
        filter: { ownerId: { "$eq": userId } },
        includeMetadata: true
      });

      // Combine relevant chunks into context
      const contextText = queryResponse.matches
        .map(match => match.metadata.text)
        .join("\n\n---\n\n");

      console.log(`RAG: Found ${queryResponse.matches.length} chunks for question: ${question.substring(0, 50)}...`);

      // 3. Draft the response with the found context
      const prompt = `
        You are an expert Bid Writer. Draft a professional response to the tender question below using the provided COMPANY CONTEXT.
        
        QUESTION: "${question}"
        
        COMPANY CONTEXT:
        ${contextText || "No specific company documents found. Use professional best practices and general knowledge."}
        
        INSTRUCTIONS:
        - Use a professional, persuasive, and confident tone.
        - Incorporate specific details from the COMPANY CONTEXT where relevant.
        - If the context doesn't fully answer the question, provide a high-quality template.
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

// --- KNOWLEDGE BASE SYNC (MODERN VERSION) ---
exports.processMasterDocument = onObjectFinalized(
  { region: "us-east1", secrets: [geminiApiKey, pineconeApiKey], timeoutSeconds: 300, memory: "1GiB" },
  async (event) => {
    const filePath = event.data.name; 
    console.log(`RAW FILE PATH DETECTED: "${filePath}"`);

    if (!filePath.toLowerCase().includes("knowledge/") || !filePath.toLowerCase().endsWith(".pdf")) {
      console.log("SKIP: File does not meet Knowledge Base criteria.");
      return;
    }

    const bucket = admin.storage().bucket(event.data.bucket);
    const pathParts = filePath.split("/");
    const fileName = pathParts[pathParts.length - 1];
    const userId = pathParts[pathParts.length - 2] || "unknown_user";

    try {
      const tempFilePath = path.join("/tmp", fileName);
      await bucket.file(filePath).download({ destination: tempFilePath });
      const dataBuffer = fs.readFileSync(tempFilePath);

      // --- MODERN PDF PARSING (pdf2json) ---
      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1); 

      const fullText = await new Promise((resolve, reject) => {
        pdfParser.on("pdfParser_dataError", errData => reject(new Error(errData.parserError)));
        pdfParser.on("pdfParser_dataReady", () => {
          const text = pdfParser.getRawTextContent();
          resolve(text);
        });
        pdfParser.parseBuffer(dataBuffer);
      });

      console.log(`PDF parsed successfully. Text length: ${fullText.length} characters.`);

      if (!fullText || fullText.length < 10) {
        throw new Error("PDF extraction yielded no usable text.");
      }

      // 3. Chunking
      const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const pc = new Pinecone({ apiKey: pineconeApiKey.value() });
      const index = pc.index("mergepoint-index");

      console.log(`Generating embeddings for ${chunks.length} chunks...`);

      const vectors = await Promise.all(chunks.map(async (chunk, i) => {
        const result = await embeddingModel.embedContent(chunk);
        return {
          id: `${userId}_${Date.now()}_${i}`,
          values: result.embedding.values,
          metadata: { text: chunk, ownerId: userId, source: fileName }
        };
      }));

      await index.upsert(vectors);
      console.log("Pinecone upsert successful.");

      // --- ROBUST FIRESTORE UPDATE ---
      const db = getFirestore("default");
      const knowledgeRef = db.collection("knowledge");
      
      const snap = await knowledgeRef
        .where("ownerId", "==", userId)
        .get();

      const docToUpdate = snap.docs.find(doc => {
        const dbFileName = doc.data().fileName;
        return fileName.includes(dbFileName) || dbFileName.includes(fileName);
      });

      if (docToUpdate) {
        await docToUpdate.ref.update({ status: "ready" });
        console.log(`Firestore status updated to 'ready' for doc ID: ${docToUpdate.id}`);
      } else {
        console.warn(`Could not find Firestore doc for user ${userId} and file ${fileName}`);
      }

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    } catch (error) {
      console.error("CRITICAL ERROR in processMasterDocument:", error.message);
    }
  }
);