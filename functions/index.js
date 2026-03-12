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
const stripeSecret = defineSecret("STRIPE_SECRET_KEY"); // Added for Stripe
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET"); // Added for Stripe

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
            <h2 style="color: #4f46e5; margin-bottom: 166px;">Welcome to MergePoint</h2>
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

      // Calculate retrieval score (averaging top vector matches)
      const avgVectorScore = results.length > 0 
        ? (results.reduce((acc, curr) => acc + curr.score, 0) / results.length) 
        : 0;

      const contextText = results.map(m => `[Source: ${m.metadata.category}]\n${m.metadata.text}`).join("\n\n");
      
      const prompt = `
        ROLE: Expert Enterprise Bid Response Writer (UK).
        TASK: Draft a formal response for a tender section using ONLY the provided supplier knowledge base.

        TENDER REQUIREMENT:
        "${question}"

        SUPPLIER KNOWLEDGE BASE:
        ${contextText}

        STRICT EDITORIAL RULES:
        1. PERSPECTIVE: Adopt the identity of the supplier. Use "We" or "Our". 
        2. NO META-TALK: Never refer to "the context" or "the database".
        3. FORMATTING: Use "•" for bullets. NO Markdown (no asterisks ** or underscores _).
        
        CONFIDENCE RATING:
        Assess how well the knowledge base answers the requirement (0-100).
        
        OUTPUT FORMAT:
        <score>CONFIDENCE_NUMBER</score>
        <answer>RESPONSE_TEXT</answer>
      `;

      const resultGen = await model.generateContent(prompt);
      const output = resultGen.response.text();

      // Extract Score and Answer
      const scoreMatch = output.match(/<score>(.*?)<\/score>/);
      const answerMatch = output.match(/<answer>([\s\S]*?)<\/answer>/);

      const aiConfidence = scoreMatch ? parseInt(scoreMatch[1]) : 70;
      const finalAnswer = answerMatch ? answerMatch[1].trim() : output;

      // Blend Vector Score (20%) and AI logic assessment (80%)
      const finalConfidence = Math.round((aiConfidence * 0.8) + ((avgVectorScore * 100) * 0.2));

      await getDb().collection("organizations").doc(limits.orgId).update({
          "usageMonth.drafts": admin.firestore.FieldValue.increment(1)
      });

      return { 
        success: true, 
        answer: finalAnswer, 
        confidence: Math.min(finalConfidence, 100) 
      };
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

/* ------------------ STRIPE CUSTOMER PORTAL ------------------ */
exports.createPortalSession = onCall(
  { 
    region: "us-east1", 
    secrets: [stripeSecret] 
  },
  async (request) => {
    // 1. Authentication Check
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const db = getDb();
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    
    if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User profile not found.');
    }

    // 2. Organization & Stripe ID Check
    const userData = userDoc.data();
    const orgId = userData.orgId;
    
    if (!orgId) {
        throw new functions.https.HttpsError('failed-precondition', 'User is not associated with an organization.');
    }

    const orgDoc = await db.collection("organizations").doc(orgId).get();
    const stripeCustomerId = orgDoc.data().stripeCustomerId;

    if (!stripeCustomerId) {
        throw new functions.https.HttpsError('failed-precondition', 'No Stripe Customer ID found for this organization.');
    }

    const stripeInst = require("stripe")(stripeSecret.value().trim());

    try {
        // 3. Create Portal Session with correct Return URL
        const session = await stripeInst.billingPortal.sessions.create({
          customer: stripeCustomerId,
          // FIXED: Hardcoded to your actual app URL to avoid the Cloud Functions subdomain error
          return_url: 'https://app.mergepoint-software.com/index.html', 
        });

        return { url: session.url };
    } catch (error) {
        console.error("Stripe Portal Error:", error);
        throw new functions.https.HttpsError('internal', 'Failed to create billing portal session.');
    }
  }
);

/* ------------------ STRIPE WEBHOOK ------------------ */
exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret] },
  async (req, res) => {
    const stripeInst = require("stripe")(stripeSecret.value().trim());
    const sig = req.headers["stripe-signature"];
    const endpointSecret = stripeWebhookSecret.value().trim();

    let event;
    try {
      event = stripeInst.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      console.error(`Webhook Signature Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const db = getDb();

    // 1. Listen for Successful Checkout
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const customerId = session.customer;
        const sessionId = session.id;

        const orgQuery = await db.collection("organizations")
            .where("stripeSessionId", "==", sessionId)
            .limit(1)
            .get();

        if (!orgQuery.empty) {
            await orgQuery.docs[0].ref.update({
                stripeCustomerId: customerId,
                plan: "pro", 
                status: "active",
                isActive: true, // Grants access
                cancelAtPeriodEnd: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Successfully linked customer ${customerId} to Org ${orgQuery.docs[0].id}`);
        }
    }

    // 2. Listen for Subscription Updates (e.g., clicking Cancel in portal)
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const orgQuery = await db.collection("organizations")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();

      if (!orgQuery.empty) {
        await orgQuery.docs[0].ref.update({
          // If true, user has canceled but still has access until period end
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          status: subscription.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Updated sub for Org ${orgQuery.docs[0].id}: cancelAtPeriodEnd=${subscription.cancel_at_period_end}`);
      }
    }

    // 3. Listen for Final Deletions (The Hard Cutoff)
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const orgQuery = await db.collection("organizations")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();

      if (!orgQuery.empty) {
        await orgQuery.docs[0].ref.update({
          plan: "starter", 
          status: "canceled",
          isActive: false, // Revokes access via Security Rules
          cancelAtPeriodEnd: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Org ${orgQuery.docs[0].id} access REVOKED via Stripe Webhook.`);
      }
    }

    res.json({ received: true });
  }
);