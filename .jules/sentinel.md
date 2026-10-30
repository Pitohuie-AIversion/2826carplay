## 2026-10-29 - [Hardcoded Webhook Keys]
**Vulnerability:** Webhook key-like values (`8e29a0f4-aijia-sentinel`) for WeCom, Feishu, and DingTalk were embedded as defaults in the web-admin frontend file.
**Learning:** Default configuration values in source control must not look like or contain real credentials. Anything shipped in a frontend bundle is trivially scraped.
**Prevention:** Use obvious placeholder values in source, refuse to dispatch requests while a placeholder is still configured, and inject real webhook URLs at runtime (user input / persisted local config / server-side config).
