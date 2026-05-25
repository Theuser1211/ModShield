# ModShield 🛡️

[![Devvit SDK Version](https://img.shields.io/badge/Devvit%20SDK-v0.12.24-orange?style=flat-square)](https://developers.reddit.com)
[![Platform Compliance](https://img.shields.io/badge/Reddit-App%20Compliant-blue?style=flat-square)](https://www.reddit.com)

**ModShield** is an automated, enterprise-grade moderation intelligence suite built natively on the Reddit Developer Platform (**Devvit SDK**). It transforms standard, reactive moderation queues into proactive community defense mechanisms by tracking per-user violation patterns with thread-safe precision and exposing a real-time management dashboard directly inside your subreddit feed.

---

## 🚀 Key Features

* **Bi-Directional Event Triggers:** Synchronously captures native `PostReport` and `CommentReport` streams to monitor subreddit wide infractions.
* **Asynchronous Anonymity Resolution:** Converts incoming `t2_` account hashes into human-readable plain strings seamlessly via a decoupled `getUserById()` abstraction layer.
* **Atomic Redis Scaling Layer:** Bypasses volatile key-value serialization blocks, opting for highly localized data sets using optimized primitives (`incrBy`, `hset`, `zadd`).
* **Interactive Block UI Console:** Embeds a full administrative command grid right inside your mod workspace featuring instant manual cache purging metrics.
* **Dual-Tier Proactive Enforcement:** Leverages distinct infraction bounds to issue mod alerts or automatically silence disruptive accounts.

---

## 📊 Technical Architecture & Math Logic

ModShield evaluates the community disruption factor using real-time report aggregations. Let $R_u$ be the cumulative reports mapped to a distinct user $u$, and $T$ represent the community's configured violation limit. 

### 1. Alert Notification Condition
When a user crosses the baseline parameter, a detailed markdown data card is constructed and routed directly to the Subreddit Modmail:

$$\text{Trigger Alert} \iff R_u \ge T$$

### 2. Auto-Mute Condition
If a malicious or spam pattern continues to escalate, ModShield safeguards the community by executing a `reddit.muteUser()` directive once infractions reach twice the base limit:

$$\text{Execute Mute} \iff R_u \ge 2T$$

### 3. Data Model
ModShield maps five independent key spaces within Redis to provide optimal access time complexity $\mathcal{O}(1)$ for real-time trigger evaluation:
* **Counters:** `modshield:viol:{username}` $\rightarrow$ Tracks atomic integer scores.
* **Sorted Sets:** `modshield:activity` $\rightarrow$ Indices chronologically by Unix epoch timestamps $t_s$.

---

## 🛠️ Project Configuration & Permissions

Your application manifest file must declare explicit scopes to securely interact with Redis hooks and Reddit's moderator capabilities. Ensure your project `devvit.yaml` matches this exact structure:

```yaml
name: mod-shield-plus
version: 0.1.0
bundled: true
entrypoint: src/main.ts
permissions:
  - identity
  - modmail
  - storage
triggers:
  - PostReport
  - CommentReport