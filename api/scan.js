export const config = { maxDuration: 25 };
export default async function handler(req, res) {

if (req.method !== "POST") {
return res.status(405).json({ error: "Method not allowed" });
}

try {

const { messages } = req.body || {};
const content = messages?.[0]?.content || [];

let textContent = "";

content.forEach(c=>{
if(c.type === "text"){
textContent += " " + c.text;
}
});

const lower = textContent.toLowerCase();

/* ---------------- SMART SCAM SIGNAL DETECTION ---------------- */

const scamSignals = [
"urgent",
"verify your account",
"account suspended",
"send money",
"bank details",
"gift card",
"crypto",
"bitcoin",
"claim reward",
"you won",
"limited time",
"click this link",
"otp",
"one time password",
"reset your password",
"confirm your account",
"security alert",
"act now",
"payment required"
];

let signalScore = 0;

scamSignals.forEach(word=>{
if(lower.includes(word)){
signalScore++;
}
});

/* ---------------- URL DETECTION ---------------- */

const urlRegex = /(https?:\/\/[^\s]+)/g;
const urls = textContent.match(urlRegex) || [];

/* suspicious domains */

const suspiciousDomains = [
"bit.ly",
"tinyurl",
"grabify",
"free-reward",
"claim-now",
"secure-login",
"verify-account",
"walletconnect",
"airdrop",
"login-security",
"update-account"
];

let phishingScore = 0;

urls.forEach(url=>{

const u = url.toLowerCase();

suspiciousDomains.forEach(domain=>{
if(u.includes(domain)){
phishingScore++;
}
});

if(url.length > 80) phishingScore++;
if(url.includes("@")) phishingScore++;

});

/* ---------------- ADD CONTEXT FOR AI ---------------- */

content.push({
type:"text",
text:`SYSTEM SCAN SIGNALS:
scam_language_hits:${signalScore}
urls_found:${urls.length}
phishing_indicators:${phishingScore}`
});

/* ---------------- AI PROMPT ---------------- */

const system = `
You are DivoX Trust, an AI scam detection engine.

Your job is to analyze messages, links, or screenshots and determine if they are scams.

Understand the difference between normal greetings and harmful content.

Safe greetings examples:
"hello"
"hi"
"how are you"
"good morning"

These must always return very low scam probability.

Look for:

• phishing links
• impersonation attempts
• fake giveaways
• crypto scams
• banking fraud
• urgency pressure
• requests for passwords or OTP
• suspicious shortened links
• social engineering

Return ONLY JSON in this format:

{
"score": number,
"label": "SAFE" or "SUSPICIOUS" or "SCAM",
"riskClass": "risk-safe" or "risk-warning" or "risk-danger",
"summary": "short explanation",
"flags": ["reason1","reason2"],
"actions":[
{
"title":"Safety advice",
"detail":"what the user should do"
}
],
"verdict":"final user-friendly result"
}
`;

/* ---------------- OPENROUTER REQUEST ---------------- */

const apiKey = process.env.OPENROUTER_API_KEY;

const response = await fetch(
"https://openrouter.ai/api/v1/chat/completions",
{
method:"POST",
headers:{
"Content-Type":"application/json",
Authorization:`Bearer ${apiKey}`,
"HTTP-Referer":"https://divoxtrust.vercel.app",
"X-Title":"DivoX Trust"
},
body:JSON.stringify({
model:"openrouter/auto",
messages:[
{ role:"system", content:system },
{ role:"user", content:content }
],
max_tokens:1200
})
}
);

const data = await response.json();

/* ---------------- RESPONSE ---------------- */

if(!data?.choices?.length){
return res.status(500).json({
error:"AI response failed"
});
}

return res.status(200).json({
content:[
{
text:data.choices[0].message.content
}
]
});

}

catch(err){

console.error(err);

return res.status(500).json({
error:"Scan failed"
});

}

}
