/* eslint-disable */
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore"); // Added correct import

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
    // 1. Auth Guard
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

      // 2. Update the Bid in Firestore using the named "default" database
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
// --- NEW GEMINI SECTION DRAFTER ---
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] }, 
  async (request) => {
    // 1. Auth Guard
    if (!request.auth) {
      throw new Error("Unauthorized: You must be logged in.");
    }

    const { question, bidId } = request.data;
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      // TODO: In a later step, we will add Pinecone RAG here to fetch 
      // your company's specific "Knowledge Base" facts to make the answer better.
      // For now, we will use Gemini's internal professional knowledge.

      const prompt = `
        You are an expert Bid Writer. I need you to draft a professional response to the following RFP question:
        
        QUESTION: "${question}"
        
        INSTRUCTIONS:
        - Use a professional, persuasive, and confident tone.
        - If the question is about company policy or experience, provide a generic high-quality template response that can be easily customized.
        - Ensure the response is concise but thorough.
        
        Return ONLY the text of the drafted response.
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Return the draft to the frontend
      return { 
        success: true, 
        answer: responseText,
        confidence: 85 // You can eventually make this dynamic based on RAG results
      };

    } catch (error) {
      console.error("Drafting Error:", error);
      return { success: false, error: error.message };
    }
  }
);