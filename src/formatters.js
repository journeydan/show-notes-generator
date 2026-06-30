export function formatMarkdown(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "";
  if (episodeTitle) out += `# ${episodeNumber ? `Ep. ${episodeNumber}: ` : ""}${episodeTitle}\n`;
  if (podcastName) out += `**${podcastName}** · ${date}\n`;
  out += "\n---\n\n## Links & Resources\n\n";
  items.filter((i) => i.status === "done").forEach((item, i) => {
    out += `### ${i + 1}. ${item.title}\n`;
    out += `🔗 ${item.url}\n\n`;
    out += `${item.summary}\n\n`;
    if (item.tags?.length) out += `*Tags: ${item.tags.join(", ")}*\n`;
    out += "\n";
  });
  if (sponsorText) {
    out += "---\n\n";
    out += `${sponsorText}\n`;
  }
  return out.trim();
}

export function formatNewsletter(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "";
  if (episodeTitle) {
    out += `${episodeNumber ? `Episode ${episodeNumber}: ` : ""}${episodeTitle}\n`;
    out += "=".repeat(60) + "\n\n";
  }
  out += `This week on ${podcastName || "the podcast"} (${date}), here's what we're covering:\n\n`;
  items.filter((i) => i.status === "done").forEach((item, i) => {
    out += `${i + 1}. ${item.title.toUpperCase()}\n`;
    out += `${item.summary}\n`;
    out += `Read more: ${item.url}\n\n`;
  });
  if (sponsorText) {
    out += "—\n\n";
    out += `${sponsorText}\n`;
  }
  return out.trim();
}

export function formatHTML(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "<!DOCTYPE html>\n<html><head><meta charset='utf-8'></head><body style='font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#333;line-height:1.6;'>\n";
  if (episodeTitle) out += `<h1>${episodeNumber ? `Ep. ${episodeNumber}: ` : ""}${escHTML(episodeTitle)}</h1>\n`;
  if (podcastName) out += `<p style="color:#888;font-size:14px;"><strong>${escHTML(podcastName)}</strong> · ${date}</p>\n`;
  out += "<hr>\n<h2>Links & Resources</h2>\n";
  items.filter((i) => i.status === "done").forEach((item, i) => {
    out += `<h3>${i + 1}. ${escHTML(item.title)}</h3>\n`;
    out += `<p><a href="${escHTML(item.url)}">${escHTML(item.url)}</a></p>\n`;
    out += `<p>${escHTML(item.summary)}</p>\n`;
    if (item.tags?.length) out += `<p style="font-size:12px;color:#888;">Tags: ${item.tags.map((t) => escHTML(t)).join(", ")}</p>\n`;
  });
  if (sponsorText) { out += "<hr>\n"; out += `<p>${escHTML(sponsorText)}</p>\n`; }
  out += "</body></html>";
  return out;
}

export function formatSocialThread(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const done = items.filter((i) => i.status === "done");
  let out = `🧵 ${podcastName || "the podcast"} — ${episodeTitle || date}\n\n`;
  done.forEach((item, i) => {
    out += `${i + 1}/${done.length} 📄 ${item.title}\n`;
    out += `${item.summary}\n`;
    out += `${item.url}\n\n`;
  });
  if (sponsorText) out += `📢 ${sponsorText}\n\n`;
  out += "🎧 Listen to the full episode!";
  return out;
}

export function escHTML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
