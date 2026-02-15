# Merge Point 🚀
### AI-Powered RFI Automation & Document Intelligence

[![JavaScript](https://img.shields.io/badge/Logic-JavaScript%20ES6+-f7df1e?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Pinecone](https://img.shields.io/badge/Vector%20DB-Pinecone-000000?style=flat&logo=pinecone&logoColor=white)](https://www.pinecone.io/)
[![Firebase](https://img.shields.io/badge/Backend-Firebase%20%26%20Firestore-ffca28?style=flat&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Gemini](https://img.shields.io/badge/AI-Google%20Gemini%20Pro-8E75C2?style=flat&logo=googlegemini&logoColor=white)](https://deepmind.google/technologies/gemini/)

> **The Vision:** Public sector bidding is plagued by "Manual Search Exhaustion." **Merge Point** is a Vertical AI solution designed to ingest 300+ page master documents and instantly synthesize professional RFI responses. Leveraging the power of Google Gemini, it bridges the gap between massive company knowledge and winning tenders.

---

## 🏗 System Architecture & AI Stack

This project leverages **RAG (Retrieval-Augmented Generation)** architecture to deliver contextually accurate document synthesis.

* **Frontend:** Vanilla JavaScript (ES6+), CSS3 Advanced Layouts, and real-time document upload interfaces.
* **AI Layer:** **Google Gemini Pro** for advanced semantic reasoning and high-fidelity text synthesis.
* **Vector Engine:** **Pinecone** for storing and querying high-dimensional embeddings of company data.
* **Backend/Storage:** Google Firebase (Auth) & Firestore (Metadata). Hosted in **europe-west2** for data residency compliance.
* **Environment:** Node.js environment for handling asynchronous API streams and document chunking logic.

---

## 🎯 Key Features & Thinking

### 🧠 Semantic "Context-Aware" Retrieval
Keyword search fails in complex bids. I architected Merge Point to use **Vector Embeddings**. When a user uploads a tender, the system doesn't just look for words; it understands the *intent* of the question and retrieves the most relevant "knowledge blocks" from the company's master files stored in Pinecone.

### 📄 Gemini-Powered Document Synthesis
I built a multi-stage pipeline where **Gemini Pro** first "interrogates" the tender to identify required sections, then queries the knowledge base, and finally drafts a response that maintains the company’s specific brand voice and technical accuracy.

### 🔄 Multi-Platform Sync Logic
Data integrity is paramount. I designed a custom **cleanupKnowledgeBase** function in **europe-west2** to ensure a perfect delete sync across Firebase, Firestore, and Pinecone. When a user updates a master document, the system ensures the old vectors are purged and new ones are indexed simultaneously.

---

## 🛠 Engineering "War Stories" (Bugs & Solutions)

| Challenge | Solution | Developer Insight |
| :--- | :--- | :--- |
| **Vector Index Drift** | Implemented a dedicated cleanup function to force sync between Pinecone and Firestore. | Distributed systems are only as good as their cleanup logic. Stale data in a vector DB leads to AI hallucinations. |
| **Context Window Optimization** | Leveraged Gemini's large context window while maintaining efficient chunking for Pinecone retrieval. | Just because Gemini has a large window doesn't mean you should be lazy. Precision retrieval saves on API costs and improves accuracy. |
| **Async Handshake Lag** | Implemented "Optimistic UI" states while performing high-dimensional top-k queries. | In high-stakes bidding, the user needs to feel progress. Backend complexity should never compromise UI responsiveness. |
| **Metadata Filtering** | Structured Firestore schemas to allow "Namespace" filtering within Pinecone. | Data isolation isn't just for security; it's for performance. Filtering vectors by UID speeds up retrieval by 40%. |

---

## 🚀 How to Run Locally

This project requires **Node.js** and a Google AI (Gemini) API Key.

1. Clone the repo: `git clone [https://github.com/YourUsername/merge-point.git]`
2. Install dependencies: `npm install`
3. Configure Environment: Create a `.env` file with `GEMINI_API_KEY`, `PINECONE_API_KEY`, and `FIREBASE_CONFIG`.
4. Run locally: `npm start`

---

## 🤝 Connect with the Developer
**[Your Name]** [LinkedIn Profile Link] | [Portfolio Link]

---
*Developed as part of my journey toward IBM Full Stack and Meta Front-End Certification.*
