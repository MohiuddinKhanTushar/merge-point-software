/* eslint-disable */
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https"); // Added HttpsError
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
const nodemailer = require("nodemailer");

admin.initializeApp();

setGlobalOptions({
  region: "us-east1",
  maxInstances: 10
});

const getDb = () => getFirestore("default");
const pineconeApiKey = defineSecret("PINECONE_API_KEY");
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const brevoSmtpPassword = defineSecret("BREVO_SMTP_PASSWORD");
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const PINECONE_INDEX = "mergepoint-index";

/* ------------------ UTIL ------------------ */
const getNamespaceForDoc = (ownerId, docId) => `kb_${ownerId}_${docId}`;

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
  { region: "us-east1", secrets: [brevoSmtpPassword] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthorized");
    const { guestEmail, guestName, adminName, inviteLink } = request.data;
    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      auth: { user: "a35555001@smtp-brevo.com", pass: brevoSmtpPassword.value().trim() },
    });
    const mailOptions = {
      from: '"MergePoint" <noreply@mergepoint-software.com>',
      to: guestEmail,
      subject: `Join ${adminName} on MergePoint`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
            <h2 style="color: #4f46e5;">Welcome to MergePoint</h2>
            <p>Hello ${guestName},<br><br><strong>${adminName}</strong> has invited you to join their team.</p>
            <div style="margin: 32px 0; text-align: center;">
                <a href="${inviteLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Accept Invitation</a>
            </div>
        </div>
      `,
    };
    try {
      await transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      throw new HttpsError("internal", error.message);
    }
  }
);

/* ------------------ DELETE USER ACCOUNT ------------------ */
exports.deleteUserAccount = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Unauthorized");
  const adminUid = request.auth.uid;
  const targetUid = request.data.uid;
  const db = getDb();
  const adminDoc = await db.collection("users").doc(adminUid).get();
  if (!adminDoc.exists || adminDoc.data().role !== 'admin') throw new HttpsError("permission-denied", "Only admins can remove users.");
  if (adminUid === targetUid) throw new HttpsError("invalid-argument", "You cannot remove yourself.");
  try {
    await admin.auth().deleteUser(targetUid);
    await db.collection("users").doc(targetUid).delete();
    return { success: true };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

/* ------------------ TENDER ANALYSIS ------------------ */
exports.analyzeTenderDocument = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, memory: "2GiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthorized");
    const { bidId, fileName } = request.data;
    const userId = request.auth.uid;
    
    try {
      const limits = await getOrgLimits(userId);
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

      // FIX: Stronger prompt to ensure the keys "sectionTitle" and "question" match what workspace.js expects
      const prompt = `Analyze this tender document. Output a JSON array of objects. 
      Each object must have "sectionTitle" and "question" keys.
      TEXT: ${tenderText.substring(0, 45000)}`;

      const result = await model.generateContent(prompt);
      const output = result.response.text();

      // FIX: Better extraction in case Gemini adds ```json blocks
      const jsonRegex = /\[[\s\S]*\]/;
      const match = output.match(jsonRegex);
      
      if (!match) throw new Error("AI did not return a valid JSON list of sections.");
      
      const sections = JSON.parse(match[0]);

      // Update Firestore
      await getDb().collection("bids").doc(bidId).update({ 
        sections: sections, 
        status: "scoping" 
      });

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      return { success: true };
      
    } catch (error) {
      console.error("Analysis Error:", error);
      return { success: false, error: error.message };
    }
  }
);

/* ------------------ RAG SECTION DRAFTER ------------------ */
exports.generateSectionDraft = onCall(
  { secrets: [geminiApiKey, pineconeApiKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthorized");
    const { question } = request.data;
    const userId = request.auth.uid;
    try {
      const limits = await getOrgLimits(userId);
      if (limits.currentDraftCount >= limits.maxDrafts) return { success: false, error: "Limit reached." };
      const db = getDb();
      const genAI = new GoogleGenerativeAI(geminiApiKey.value().trim());
      const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const embedResult = await embedModel.embedContent({ content: { parts: [{ text: question }] }, outputDimensionality: 768 });
      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      const index = pc.index(PINECONE_INDEX);
      const snap = await db.collection("knowledge").where("ownerId", "==", userId).where("excludeFromAI", "==", false).get();
      const queries = snap.docs.map(doc => index.namespace(getNamespaceForDoc(userId, doc.id)).query({ vector: embedResult.embedding.values, topK: 5, includeMetadata: true }));
      const resultsList = await Promise.all(queries);
      const results = resultsList.flatMap(r => r.matches || []).sort((a, b) => b.score - a.score).slice(0, 8);
      
      // Setup Context Text for the prompt
      const contextText = results.map(m => `[Source: ${m.metadata.category}]\n${m.metadata.text}`).join("\n\n---\n\n");

      // Updated Expert Enterprise Prompt
      const prompt = `
        ROLE: Expert Enterprise Bid Response Writer (UK).
        TASK: Draft a formal response for a tender section using ONLY the provided supplier knowledge base.

        TENDER REQUIREMENT:
        "${question}"

        SUPPLIER KNOWLEDGE BASE:
        ${contextText}

        STRICT EDITORIAL RULES:
        1. PERSPECTIVE: Adopt the identity of the supplier described in the knowledge base. Use "We", "Our", or the Company Name found in the text. 
        2. NO META-TALK: Never refer to "the context", "the database", "the provided text", or "the knowledge base".
        3. TONE: Professional, authoritative, and evidence-based. Avoid "fluff" or generic marketing adjectives.
        4. FORMATTING: 
            - Use "•" for bullet points.
            - Use "1.", "2." for numbered processes.
            - For sub-headings, use ALL CAPS followed by a line break.
            - NO Markdown (strictly no asterisks ** or underscores _). 
        5. ACCURACY: If the knowledge base is silent on a specific requirement, do NOT hallucinate. 

        OUTPUT STRUCTURE:
        [Directly start with the response content. Do not include introductory phrases like "Here is the response".]

        --- INTERNAL NOTES: MISSING EVIDENCE ---
        [List only if applicable. Identify specific gaps where the supplier needs to provide more detail to meet enterprise standards. If the information is sufficient, omit this entire section.]

        FINAL REQUIREMENT: The output must be "Submission-Ready" for a formal PDF/Word proposal.
      `;

      const resultGen = await model.generateContent(prompt);
      await db.collection("organizations").doc(limits.orgId).update({ "usageMonth.drafts": admin.firestore.FieldValue.increment(1) });
      
      return { 
        success: true, 
        answer: resultGen.response.text(), 
        confidence: results.length > 0 ? Math.round(results[0].score * 100) : 50 
      };
    } catch (error) {
      console.error("Draft Generation Error:", error);
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
      const index = pc.index(PINECONE_INDEX).namespace(getNamespaceForDoc(userId, metaDoc.id));
      const vectors = await Promise.all(chunks.map(async (chunk, i) => {
        const res = await embedModel.embedContent({ content: { parts: [{ text: chunk }] }, outputDimensionality: 768 });
        return { id: `${metaDoc.id}_${i}`, values: res.embedding.values, metadata: { text: chunk, category: metaDoc.data().category }};
      }));
      await index.upsert(vectors);
      await metaDoc.ref.update({ status: "ready", vectorizedAt: admin.firestore.FieldValue.serverTimestamp() });
      await db.collection("organizations").doc(limits.orgId).update({ docCount: admin.firestore.FieldValue.increment(1) });
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
      const pc = new Pinecone({ apiKey: pineconeApiKey.value().trim() });
      await pc.index(PINECONE_INDEX).namespace(getNamespaceForDoc(data.ownerId, event.params.docId)).deleteAll();
    } catch (e) { console.error(e); }
  }
);

/* ------------------ MONTHLY USAGE RESET ------------------ */
exports.resetMonthlyUsage = onSchedule({
    schedule: "0 0 1 * *",
    region: "europe-west2",
    timeZone: "Europe/London"
}, async (event) => {
    const snapshot = await getDb().collection("organizations").get();
    const batch = getDb().batch();
    snapshot.forEach((doc) => batch.update(doc.ref, { "usageMonth.drafts": 0 }));
    await batch.commit();
});

/* ------------------ NEW: ATTACH STRIPE CUSTOMER ------------------ */
exports.attachStripeCustomer = onCall(
  { region: "us-east1", secrets: [stripeSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Unauthorized");
    const { sessionId, orgId } = request.data;
    if (!sessionId || !orgId) throw new HttpsError("invalid-argument", "Missing IDs");

    const stripeInst = require("stripe")(stripeSecret.value().trim());
    try {
      const session = await stripeInst.checkout.sessions.retrieve(sessionId);
      if (session.customer) {
        await getDb().collection("organizations").doc(orgId).update({
          stripeCustomerId: session.customer,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
      }
      throw new HttpsError("not-found", "No customer in session");
    } catch (error) {
      throw new HttpsError("internal", error.message);
    }
  }
);

/* ------------------ STRIPE CUSTOMER PORTAL ------------------ */
exports.createPortalSession = onCall(
  { region: "us-east1", secrets: [stripeSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    
    const db = getDb();
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    const orgId = userDoc.data()?.orgId;
    const orgRef = db.collection("organizations").doc(orgId);
    const orgDoc = await orgRef.get();
    let stripeCustomerId = orgDoc.data()?.stripeCustomerId;

    // Safety Net: Fetch if missing
    if (!stripeCustomerId && orgDoc.data()?.stripeSessionId) {
        const stripeInst = require("stripe")(stripeSecret.value().trim());
        const session = await stripeInst.checkout.sessions.retrieve(orgDoc.data().stripeSessionId);
        stripeCustomerId = session.customer;
        if (stripeCustomerId) await orgRef.update({ stripeCustomerId });
    }

    if (!stripeCustomerId) throw new HttpsError('failed-precondition', 'No Stripe ID found.');

    const stripeInst = require("stripe")(stripeSecret.value().trim());
    try {
        const session = await stripeInst.billingPortal.sessions.create({
          customer: stripeCustomerId,
          return_url: 'https://app.mergepoint-software.com/index.html', 
        });
        return { url: session.url };
    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
  }
);

/* ------------------ STRIPE WEBHOOK ------------------ */
exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret] },
  async (req, res) => {
    const stripeInst = require("stripe")(stripeSecret.value().trim());
    const sig = req.headers["stripe-signature"];
    try {
      const event = stripeInst.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value().trim());
      const db = getDb();

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const orgQuery = await db.collection("organizations").where("stripeSessionId", "==", session.id).limit(1).get();
        if (!orgQuery.empty) {
          await orgQuery.docs[0].ref.update({ stripeCustomerId: session.customer, status: "active", isActive: true });
        }
      }
      res.json({ received: true });
    } catch (err) { res.status(400).send(err.message); }
  }
);