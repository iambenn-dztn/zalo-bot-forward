const axios = require("axios");

// Detect and replace special links in the text
function replaceSpecialLinks(text) {
  // Replace miki.shpee.cc links with https://www.jtik.io.vn/
  text = text.replace(
    /https?:\/\/miki\.shpee\.cc\/?(\S*)/gi,
    "https://www.jtik.io.vn/",
  );

  // Replace facebook.com links with https://www.facebook.com/share/p/1Ao5S1CAET/
  text = text.replace(
    /https?:\/\/(www\.)?facebook\.com\S*/gi,
    "https://www.facebook.com/share/p/1Ao5S1CAET/",
  );

  return text;
}

async function transformText(text) {
  try {
    // First, replace special links
    const replacedText = replaceSpecialLinks(text);

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
      data: { text: replacedText },
    };

    const response = await axios.request(config);
    const { transformedText } = response.data.data;

    return transformedText || replacedText;
  } catch (error) {
    console.error("❌ Error transforming text:", error);
    // Still apply link replacement if API fails
    return replaceSpecialLinks(text);
  }
}

module.exports = {
  transformText,
  replaceSpecialLinks,
};
