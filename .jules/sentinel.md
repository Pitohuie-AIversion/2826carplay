## $(date +%Y-%m-%d) - [Hardcoded Webhook Keys]
**Vulnerability:** Found hardcoded webhook keys (8e29a0f4-aijia-sentinel) for WeCom, Feishu, and DingTalk directly embedded in the web-admin frontend file.
**Learning:** Default configuration values in source control must not contain live credentials. These are easily scraped if the source or frontend bundles are exposed.
**Prevention:** Use placeholder values in source code and inject real configurations via environment variables or prompt the user for input during setup/runtime.
