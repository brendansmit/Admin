async function sendServerChan(sendKey, title, description) {
  if (!sendKey) {
    const error = new Error("ServerChan key is not configured");
    error.statusCode = 400;
    throw error;
  }

  const body = new URLSearchParams({
    title,
    desp: description
  });

  const response = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`ServerChan failed with HTTP ${response.status}`);
    error.statusCode = 502;
    error.details = text;
    throw error;
  }

  return text;
}

export { sendServerChan };

