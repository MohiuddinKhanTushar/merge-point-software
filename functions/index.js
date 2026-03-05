/* eslint-disable */
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
const nodemailer = require("nodemailer"); // Added for invites


admin.initializeApp();

// Kept as us-east1 to ensure storage bucket delete sync remains functional
setGlobalOptions({
  region: "us-east1",
  maxInstances: 10
});

const getDb = () => getFirestore("default");
const pineconeApiKey = defineSecret("PINECONE_API_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const brevoSmtpPassword = defineSecret("BREVO_SMTP_PASSWORD"); // Added for invites

const PINECONE_INDEX = "mergepoint-index";

/* ------------------ UTIL ------------------ */
const getNamespaceForDoc = (ownerId, docId) =>
  `kb_${ownerId}_${docId}`;

/**
 * Helper to fetch Org Limits based on Plan
 */
async function getOrgLimits(userId) {
    const db = getDb();
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) throw new Error("User record not found.");
    
    const orgId = userDoc.data().orgId;
    const orgDoc = await db.collection("organizations").doc(orgId).get();
    if (!orgDoc.exists) throw new Error("Organization record not found.");
    
    const orgData = orgDoc.data();
    const plan = (orgData.plan || "starter").toLowerCase();

    const limits = {
        "starter": { docs: 100, drafts: 20 },
        "business": { docs: 1000, drafts: 250 },
        "enterprise": { docs: 10000, drafts: 10000 }
    };

    const tier = limits[plan] || limits["starter"];

    return {
        orgId: orgId,
        plan: plan,
        maxDocs: tier.docs,
        maxDrafts: tier.drafts,
        currentDocCount: orgData.docCount || 0,
        currentDraftCount: (orgData.usageMonth && orgData.usageMonth.drafts) || 0
    };
}

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

/* ------------------ EMAIL INVITE FUNCTION ------------------ */
exports.sendInviteEmail = onCall(
  { 
    region: "us-east1", // Explicitly match your frontend
    secrets: [brevoSmtpPassword],
  },
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");

    const { guestEmail, guestName, adminName, inviteLink } = request.data;

    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      auth: {
        user: "a35555001@smtp-brevo.com", 
        pass: brevoSmtpPassword.value().trim(),
      },
    });

    const mailOptions = {
      from: '"MergePoint" <noreply@mergepoint-software.com>',
      to: guestEmail,
      subject: `Join ${adminName} on MergePoint`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
            <h2 style="color: #4f46e5; margin-bottom: 16px;">Welcome to MergePoint</h2>
            <p style="font-size: 16px; line-height: 1.6;">
                Hello ${guestName},<br><br>
                <strong>${adminName}</strong> has invited you to join their team on <strong>MergePoint</strong>.
            </p>
            <div style="margin: 32px 0; text-align: center;">
                <a href="${inviteLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
                    Accept Invitation
                </a>
            </div>
            <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                Sent via MergePoint Software Ltd.
            </p>
        </div>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error("EMAIL ERROR:", error);
      throw new Error("Failed to send email: " + error.message);
    }
  }
);

/* ------------------ DELETE USER ACCOUNT ------------------ */
exports.deleteUserAccount = onCall(async (request) => {
  // 1. Security Check: Is the person making this request logged in?
  if (!request.auth) throw new Error("Unauthorized");

  const adminUid = request.auth.uid;
  const targetUid = request.data.uid;

  // 2. Security Check: Is the person making this request an Admin?
  const db = getDb();
  const adminDoc = await db.collection("users").doc(adminUid).get();
  
  if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
    throw new Error("Permission Denied: Only admins can remove users.");
  }

  // 3. Prevent self-deletion via this specific function
  if (adminUid === targetUid) {
    throw new Error("You cannot remove yourself. Contact another admin.");
  }

  try {
    // 4. Delete from Firebase Authentication
    await admin.auth().deleteUser(targetUid);

    // 5. Delete from Firestore Users Collection
    await db.collection("users").doc(targetUid).delete();

    return { success: true };
  } catch (error) {
    console.error("Deletion Error:", error);
    throw new Error("Failed to delete user: " + error.message);
  }
});

/* ------------------ TENDER ANALYSIS ------------------ */
exports.analyzeTenderDocument = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, memory: "2GiB" },
  async (request) => {
    if (!request.auth) throw new Error("Unauthorized");
    const { bidId, fileName } = request.data;
    const userId = request.auth.uid;

    try {
      const limits = await getOrgLimits(userId);
      if (limits.currentDraftCount >= limits.maxDrafts) {
          throw new Error(`AI usage limit reached for ${limits.plan} plan.`);
      }

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

      await getDb().collection("organizations").doc(limits.orgId).update({
        "usageMonth.drafts": admin.firestore.FieldValue.increment(1)
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
      const limits = await getOrgLimits(userId);
      if (limits.currentDraftCount >= limits.maxDrafts) {
          return { success: false, error: "Monthly AI draft limit reached. Please upgrade." };
      }

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

      const resultsList = await Promise.all(queries);
      const results = resultsList
        .flatMap(r => r.matches || [])
        .sort((a, b) => b.score - a.score).slice(0, 8);

      const contextText = results.map(m => `[Source: ${m.metadata.category}]\n${m.metadata.text}`).join("\n\n");
      const prompt = `QUESTION: "${question}"\n\nCONTEXT:\n${contextText}\n\nWrite a professional response.`;
      const resultGen = await model.generateContent(prompt);

      await getDb().collection("organizations").doc(limits.orgId).update({
          "usageMonth.drafts": admin.firestore.FieldValue.increment(1)
      });

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

      const limits = await getOrgLimits(userId);
      if (limits.currentDocCount >= limits.maxDocs) {
          console.error(`Limit reached for org ${limits.orgId}. Skipping vectorization.`);
          await metaDoc.ref.update({ status: "limit_exceeded" });
          return;
      }

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
      await db.collection("organizations").doc(limits.orgId).update({
          docCount: admin.firestore.FieldValue.increment(1)
      });

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
    const db = getDb();
    
    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(data.storagePath);
      if ((await file.exists())[0]) await file.delete();
    } catch (e) {}

    if (!data.excludeFromAI) {
      try {
        const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
        await pc.index(PINECONE_INDEX).namespace(getNamespaceForDoc(data.ownerId, event.params.docId)).deleteAll();
        
        const userDoc = await db.collection("users").doc(data.ownerId).get();
        if (userDoc.exists) {
            const orgId = userDoc.data().orgId;
            await db.collection("organizations").doc(orgId).update({
                docCount: admin.firestore.FieldValue.increment(-1)
            });
        }
      } catch (e) {
          console.error("Cleanup Error:", e);
      }
    }
  }
);

/* ------------------ MONTHLY USAGE RESET ------------------ */
exports.resetMonthlyUsage = onSchedule({
    schedule: "0 0 1 * *",
    region: "europe-west2",
    timeZone: "Europe/London"
}, async (event) => {
    const db = getDb();
    const orgsRef = db.collection("organizations");
    
    try {
        const snapshot = await orgsRef.get();
        const batch = db.batch();

        snapshot.forEach((doc) => {
            batch.update(doc.ref, {
                "usageMonth.drafts": 0,
                "usageMonth.lastReset": admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
        console.log(`Successfully reset monthly usage for ${snapshot.size} organizations.`);
    } catch (error) {
        console.error("Error resetting monthly usage:", error);
    }
});