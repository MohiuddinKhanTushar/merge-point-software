/* eslint-disable */
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { Pinecone } = require("@pinecone-database/pinecone");

setGlobalOptions({ maxInstances: 10 });

const pineconeApiKey = defineSecret("PINECONE_API_KEY");

exports.checkPineconeConnection = onRequest(
  { secrets: [pineconeApiKey] }, 
  async (req, res) => {
    try {
      // 1. Get the raw value and trim it to remove hidden spaces/newlines
      const rawValue = pineconeApiKey.value().trim();

      if (!rawValue) {
        throw new Error("Secret PINECONE_API_KEY is empty.");
      }

      // 2. Initialize Pinecone
      const pc = new Pinecone({
        apiKey: rawValue,
      });

      // 3. Test the connection
      const indexList = await pc.listIndexes();
      
      res.status(200).send({
        status: "success",
        message: "MergePoint is officially connected!",
        indexes: indexList.indexes,
      });
    } catch (error) {
      // Log the error details to the Firebase console for debugging
      console.error("Connection Debug:", error.message);
      
      res.status(500).send({
        status: "error",
        message: "Pinecone rejected the key. Check if the key matches the index project.",
        details: error.message
      });
    }
  }
);