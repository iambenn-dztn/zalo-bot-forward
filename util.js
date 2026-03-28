const axios = require("axios");

async function transformText(text) {
  try {
    const apiKey = process.env.API_TRANSFORM_TEXT_API_KEY || "Sontung123@";
    const apiUrl =
      "https://jtik-server.onrender.com" || "http://127.0.0.1:3001";
    let config = {
      method: "post",
      url: `${apiUrl}/api/shopee/transform-text`,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      data: { text },
    };

    const response = await axios.request(config);
    const { transformedText } = response.data.data;

    return transformedText || text;
  } catch (error) {
    console.error("❌ Error transforming text:", error);
    return text;
  }
}

module.exports = {
  transformText,
};
