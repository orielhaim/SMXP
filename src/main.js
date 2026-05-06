import config from "./config.js";
import { initSchema } from "./store/schema.js";
import { startServer } from "./server/index.js";
import { sendMessage } from "./client/send.js";

// אתחול DB
initSchema(config.dbPath);

// הפעלת שרת תמיד
startServer();

// אם נשלח פקודת send — שלח הודעה
const args = process.argv.slice(2);
if (args[0] === "send" && args.length >= 4) {
  const from = args[1];
  const to = args[2];
  const body = args[3];
  const subject = args[4] || "";

  // חכה רגע שהשרת יעלה
  await new Promise((r) => setTimeout(r, 100));

  try {
    await sendMessage({ from, to, subject, body });
    console.log("[MAIN] Message sent successfully!");
  } catch (err) {
    console.error("[MAIN] Send failed:", err.message);
  }
}
