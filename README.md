# Merge Point 🚀

**Merge Point** is an AI-powered document intelligence platform designed to automate the complex process of responding to Public Sector RFIs and Tenders. By leveraging **Vector Embeddings** and **RAG (Retrieval-Augmented Generation)**, it transforms static company "Master Documents" into a dynamic knowledge base, reducing a multi-day drafting process into a matter of minutes.

## 💡 The Problem
During my tenure spearheading Public Sector sales, I identified a recurring bottleneck: responding to a single RFI required manual sifting through 300+ page master documents to extract relevant company data. This process was inefficient, prone to human error, and cost teams hundreds of man-hours per year.

## 🛠 The Solution
**Merge Point** automates the extraction and drafting phase of bid management:
1.  **Knowledge Base Creation:** The system ingests master documents, case studies, and product updates.
2.  **Vectorization:** Data is chunked, vectorized, and stored in a high-performance database for semantic search.
3.  **Tender Analysis:** The user uploads a new bid/tender document.
4.  **AI-Driven Drafting:** The software analyzes the tender requirements, queries the knowledge base for the most relevant data points, and generates a professional, high-fidelity RFI response draft.

---

## 🏗 Technical Architecture
* **AI & LLM:** Integration with OpenAI for tender analysis and document synthesis.
* **Vector Database:** **Pinecone** for storing and retrieving high-dimensional document embeddings.
* **Database & Auth:** **Firestore** for metadata storage and **Firebase** for secure user authentication.
* **Backend:** Node.js managing the document processing pipeline and context-window optimization.
* **Cloud Infrastructure:** Hosted and synchronized via **Google Cloud (europe-west2)** to ensure high availability and data residency compliance.

---

## 🌟 Key Features
* **Automated Requirements Extraction:** AI breaks down complex tenders into specific, actionable sections.
* **Semantic Retrieval:** Queries the Knowledge Base based on the *meaning* of the tender question, not just keywords.
* **Draft Generation:** Produces submission-ready professional responses that maintain the company’s brand voice.
* **Scalable Data Ingestion:** Easily update the knowledge base with new case studies to keep the AI informed.

---

## 📈 Engineering Challenges Overcome
* **Context Accuracy:** Fine-tuning the retrieval process to ensure the AI only uses verified company data from the knowledge base.
* **Large Document Handling:** Implementing efficient chunking strategies for 300+ page documents to stay within LLM token limits while maintaining context.
* **Cross-Platform Sync:** Managing synchronized deletions and updates across Firebase, Firestore, and Pinecone to maintain data integrity.

---

## ⚙️ Installation & Setup
1.  Clone the repository:
    ```bash
    git clone [https://github.com/](https://github.com/)[YourUsername]/merge-point.git
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Set up your environment variables in a `.env` file:
    ```text
    PINECONE_API_KEY=your_key
    FIREBASE_CONFIG=your_config
    OPENAI_API_KEY=your_key
    ```
4.  Run the application:
    ```bash
    npm start
    ```

---

## 🤝 Connect with the Developer
**Mohiuddin Khan** <br>
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/mohiuddinkhan/)  [![Portfolio](https://img.shields.io/badge/Portfolio-FF5722?style=for-the-badge&logo=todoist&logoColor=white)](https://mohiuddinkhantushar.github.io/personal-portfolio-website/)
