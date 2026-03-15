document.addEventListener("DOMContentLoaded", function () {

  const analyzeBtn = document.getElementById("analyseBtn");
  const messageInput = document.getElementById("messageInput");
  const resultBox = document.getElementById("result");

  if (!analyzeBtn) {
    console.error("Analyse button not found");
    return;
  }

  analyzeBtn.addEventListener("click", async function () {

    try {

      const message = messageInput ? messageInput.value.trim() : "";

      if (!message) {
        alert("Please enter a message to analyze.");
        return;
      }

      analyzeBtn.disabled = true;

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: message
            }
          ]
        })
      });

      const data = await response.json();

      let result;

      try {
        result = JSON.parse(data.content[0].text);
      } catch {
        result = {
          verdict: "Unable to parse AI response.",
          summary: "The AI returned an unexpected format."
        };
      }

      if (resultBox) {
        resultBox.innerHTML = `
          <h3>${result.verdict || "Analysis Result"}</h3>
          <p>${result.summary || ""}</p>
        `;
      }

    } catch (err) {

      console.error(err);
      alert("Something went wrong. Please try again.");

    } finally {

      analyzeBtn.disabled = false;

    }

  });

});
