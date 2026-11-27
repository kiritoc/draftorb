# BL-040 — Riot Games policy research (primary sources)

- **Date checked:** 2026-11-27 (all live pages fetched this date unless noted otherwise; Wayback captures carry their own capture dates).
- **Scope:** Riot's official terms and DevRel policy statements relevant to (a) reading the League Client API (LCU) and the Live Client Data API for in-game advice (issue #180), and (b) the API terms already in use by the ETL pipeline and planned app distribution (issue #181).
- **Method:** Primary sources only — developer.riotgames.com policy pages, Riot Developer Relations support articles, riotgames.com legal/DevRel pages, Riot's engineering blog, and the CommunityDragon project site/docs (flagged as fan-maintained, **not** a Riot source). Where a live page returned 403/404 or is JS-rendered, the Wayback Machine capture is cited. Third-party blogs were used only for discovery, never as evidence.
- **Important caveat for the owner:** this report quotes policy text verbatim but does **not** interpret it into a verdict. Per ticket #180, the owner must read the linked passages themselves; an AI summary alone is not sign-off.

---

## A. LCU + Live Client Data API (issue #180)

### A1. Riot Developer Portal — API Terms & Conditions

**Source:** https://developer.riotgames.com/terms — section anchors: `#definitions`, `#limitations-on-usage`, `#licensed-uses-and-restrictions`, `#api-keys`, `#termination`, `#general-data-protection-regulation`
**Fetched:** 2026-11-27. **Wayback:** http://web.archive.org/web/20260714053628/https://developer.riotgames.com/terms (capture 2026-07-14)
**Note:** header reads "LAST UPDATED: DECEMBER 9, 2013".

Relevant verbatim passages:

- Definition scope (whether LCU/liveclientdata fall under "Riot Games API" is itself a definitional question — see Unverifiable items):

  > "'Riot Games API' means any application programming interface(s) and other related information (which may consist of software, data, functions, features, code, instructions and/or other technology) currently accessible through the Riot Developer Site, and as may be identified in the Specifications and/or designated by Riot from time to time in Riot's sole discretion."

- Rate limit floor for development keys:

  > "A Development Key shall not be permitted to make more than ten (10) network calls every ten (10) seconds."

- Prohibited uses (verbatim list, abridged to the clauses most relevant here):

  > "* Using the Riot Games API in a manner that disrupts, circumvents, or interferes with any part of the Game; or forges or modifies any data processed or distributed by the Game, such as, but not limited to spyware, adware or malware; or enables or promotes cheating in the Game.
  >
  > - Using the Riot Games API to collect any additional information about the Game or Game users that is not provided Game Information or permitted by the Riot Games API.
  > - Using the Riot Games API to use, distribute or transmit the Game Information in any manner not authorized under these API Terms.
  > - Altering, modifying, deleting, or otherwise interfering with or in any manner compromising any content, programming, services and/or features contained on or through the Game.
  > - Using the Riot Games API for any Application that constitutes, promotes or is used in connection with or installs any type of bot, virus, worm, Trojan-horse routing, trap door, time bomb or any other codes or instructions that are designed to monitor, distort, delete, disable, damage or disassemble the Game (or its ability to communicate and function with other computers running the Game), or any user's computer.
  > - Sending messages to or communicating with (or attempting to do the foregoing) other users of the Game through Game Information obtained from the Riot Games API.
  > - Attempting to modify the Riot Games API or Game in any way.
  > - Attempting to modify other software, the operating systems or configuration settings of other services directly or through manipulating the Game without a party's express and informed permission.
  > - Distributing, selling, transferring, encumbering, sublicensing, renting, loaning, lending or leasing the Riot Games API, any component thereof, and/or access thereto to any third party.
  > - Attempting to reverse engineer, decompile, disassemble or otherwise attempt to discover or directly access the source code of the Riot Games API, Game, and/or any component thereof except to the extent provided in such source code form by Riot hereunder."

- Key confidentiality / sharing:

  > "You may only access the Riot Games API with the API Key(s) provided to You by Riot. You may not sell, transfer, sublicense or otherwise disclose Your API Key(s) to any other party. Maintaining account security is very important. You are entirely responsible for maintaining the confidentiality of Your API Key(s)."

- One developer account:

  > "To access and use the Riot Games API, You may create only one (1) developer account…"

- Termination / data deletion:

  > "Upon termination of these API Terms, You shall immediately cease using the Materials, including without limitation any Game Information in Your possession, as well as delete all of the Game Information in Your possession."

- GDPR erasure forwarding:
  > "When Riot Games receives a request from an end user to delete their personal data, we will be passing the request to all active developers by sharing a list of identifiers (e.g. accountId) for the end users through Riot Channels."

### A2. Developer API Policy — League Client API and Game Client API / Live Client Data API sections

**Source:** https://developer.riotgames.com/league-client-apis.html — this single page hosts the full "Developer API Policy" document including the `#league-client-api`, `#game-client-api`, `#live-client-data-api` anchors.
**Fetched:** 2026-11-27 (live page returned full text).

Verbatim passages:

- League Client API status:

  > "Specifically, we're referring to a set of protocols that the Chromium Embedded Framework (CEF) uses to communicate with a C++ Library that in turn communicates with the League of Legends platform. As you'll notice, the communications between the C++ library and the CEF all occur locally on your desktop. This is the League Client API. This service is not officially supported for use with third party applications.
  >
  > **NOTE:** We provide no guarantees of full documentation, service uptime, or change communication for unsupported services. This team does not own any components of the underlying services, and will not offer additional support related to them."

- LCU registration requirement:

  > "Whether you're combining the Riot Games API and League Client API, or doing something by only using the League Client endpoints, we need to know about it. Either create a new application or leave a note on your existing application in the Developer Portal. We need to know which endpoints you're using and how you're using them in order to expand on current or future feature sets."

- Game Client API scope (the Live Client Data API is documented under this heading):

  > "The Game Client APIs are served over HTTPS by League of Legends game client and are only available locally for native applications."

- Live Client Data API description:

  > "The Live Client Data API provides a method for gathering data during an active game. It includes general information about the game as well player data."

- Game Integrity (top-of-page policy bullets, apply to all products):

  > "* Products must not use or incorporate information not present in the game client that would give players a competitive edge (e.g., automatically or manually allowing tracking enemy ultimate cooldowns), especially when such data is not already accessible through regular gameplay.
  >
  > - Products cannot alter the goal of the game (i.e. Destroy the Nexus).
  > - Products cannot create an unfair advantage for players, like a cheating program or giving some players an advantage that others would not otherwise have.
  > - Products should increase, and not decrease the diversity of game decisions (builds, compositions, characters, decks).
  > - Products should not remove game decisions, but may highlight decisions that are important and give multiple choices to help players make good decisions.
  > - Products cannot create alternatives for official skill ranking systems such as the ranked ladder. Prohibited alternatives include MMR or ELO calculators.
  > - Products cannot identify or analyze players who are deliberately hidden by the game."

- Approved vs unapproved use cases (Game Policy section):

  > Approved: "Game overlays that provide static data that is available prior to the game." / "Training tools that allow players to view their own match histories and aggregate stats."
  > Unapproved: "Products may not provide any game-session-specific information that would be previously unknown to the player." / "Apps that dictate player decisions." / "Products may not publicly display a player's match history from the custom match queue unless the player opts in…"

- Non-endorsement boilerplate (required "in a location that is readily visible to players"):
  > "[Your Product Name] is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc"

**Historical version (Wayback 2019-08-20):** http://web.archive.org/web/20190820161636/https://developer.riotgames.com/league-client-apis.html
The 2019 version of the same page contained "What it's for" / "What it's not for" lists that are **no longer present on the live page as of 2026-11-27**:

> "What it's not for — Should not (Riot will direct changes to the product): Create features that oppose or challenge systems in the game. For example: Don't create an alternative reporting system. Create features that have the potential of hurting another player's experience. For example: Don't create commentary on another player's performance (i.e., Player A is on tilt). — Cannot (Riot will shut the product down): … Don't break competitive integrity. Don't negatively affect player behavior. … Replace features. For example: Don't create an alternative client. … Manipulate or mislead players. For example: Don't replace Riot marketing content in the client with custom content. … Use as an alternative to supported third party developer tools except where otherwise noted in any official exceptions, if any."
> Whether these bullets were moved elsewhere or dropped is unverifiable; quote them only as historical policy text.

### A3. Riot DevRel blog posts on LCU policy

- **Oct 24, 2018** — "League Client APIs Policy Update" (Gene Chorba): https://www.riotgames.com/en/DevRel/league-client-apis-policy-update — fetched 2026-11-27.

  > "Have a seat. Let's talk about what my team calls the "grey area" between the Riot API endpoints and whatever iLlEgAl MoDs do. We've spoken to several developers with questions about what we call League Client APIs, and we've given some advice in the past that we'd like to update. Follow the link for details."

- **Jan 24, 2019** — "Changes to the LCU API Policy" (Gene Chorba): https://www.riotgames.com/en/DevRel/changes-to-the-lcu-api-policy — fetched 2026-11-27.

  > "We announced in October 2018 that developers could begin to create tools using the LCU API … After reviewing some of the applications that have been released and talking to our regional offices we will be making some changes.
  >
  > - For the time being we will no longer allow players in Korea to use applications leveraging the League Client API.
  > - Before you release an application (or an update to your existing application) that uses the League Client API in any region, you must contact us and let us know.
  > - Only endpoints on our approved list are allowed for use by developers"

- **Apr 24, 2019** — "New League Client API Policy" (Gene Chorba): https://www.riotgames.com/en/DevRel/new-league-client-api-policy — fetched 2026-11-27.

  > "In late 2018 Riot began engaging with developers who leveraged League Client APIs for developing tools for players. We have seen some pretty amazing things along the way. However, we quickly discovered that the policies around use of these APIs were confusing to developers. We have updated our policy and we encourage you to read it on the Developer Portal."

- **Apr 1, 2024** — "Vanguard FAQ for Third Party Applications": https://www.riotgames.com/en/DevRel/vanguard-faq — fetched 2026-11-27. Wayback: http://web.archive.org/web/20260616064405/https://www.riotgames.com/en/DevRel/vanguard-faq
  > "3. What happens to existing apps that use memory reading? Overlays and internal tools using the API, game client, and in-game APIs should continue to function. External tools reading memory will no longer work, and you'l need to change methods."
  > "5. Will the LCU be impacted by Vanguard? Apps developed using the LCU and in-game APIs are still expected to work. Please note the LCU and in-game APIs are not owned by Developer Relations and we cannot offer support or guarantee updates when using these methods."
  > "4. Is it possible to get on an allow list? No - There is absolutely no allow list for Vanguard."

### A4. Riot Developer Relations — General Policies (support article)

**Source:** https://support-developer.riotgames.com/hc/en-us/articles/22698591841939-General-Policies — "May 29, 2025 17:12 Updated"
**Fetched:** live URL returned HTTP 403 on 2026-11-27; text obtained from Wayback capture 2026-07-18: http://web.archive.org/web/20260718155910/https://support-developer.riotgames.com/hc/en-us/articles/22698591841939-General-Policies

Verbatim passages:

- Scope and enforcement:

  > "In addition to those documents, we also provide the following General Policies that all products in the Riot Games third-party ecosystem must adhere to. Failure to meet these policies may result in either suspension or cancellation of your API access or legal recourse."

- Data ingestion / LCU:

  > "* Products should use supported services from Riot Games for data ingestion
  >
  > - If your product utilizes the League Client API
  >   - Read the League Client documentation
  >   - Register your product through the Developer Portal"

- Asset whitelist:

  > "* Use the following assets in the development and marketing of your product: Data Dragon; Press Kit; TFT Assets; LOR Assets; VAL Assets"

- Required boilerplate (note: wording differs slightly from the LoL policy page — "isn't endorsed … doesn't reflect"):

  > "> [Your product] isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."

- Game Integrity (General Policies version):

  > "* Products cannot alter the goal of the game (i.e. Destroy the Nexus).
  >
  > - Products cannot create an unfair advantage for players, like a cheating program or giving some players an advantage that others would not otherwise have.
  > - Products should increase, and not decrease the diversity of game decisions (builds, compositions, characters, decks).
  > - Products should not remove game decisions, but may highlight decisions that are important and give multiple choices to help players make good decisions.
  > - Products cannot create alternatives for official skill ranking systems such as the ranked ladder. Prohibited alternatives include MMR or ELO calculators. …
  > - Products cannot de-anonymize players who cannot reasonably be identified from visible information.
  >   - Products may not expose a player's historic Riot IDs"

- Developer Safety:
  > "* Don't share your Riot Games account information with anyone
  >
  > - Do not use a Production API key to run multiple projects (one product per key)
  > - Make sure that you are using SSL/HTTPS when accessing the APIs so that your API key is kept safe.
  > - Do not include your API key in your code, especially if you plan on distributing a binary"

### A5. Riot Games Terms of Service — User Rules (Section 7)

**Source:** https://www.riotgames.com/en/terms-of-service — "Last Modified: December 1, 2024"
**Fetched:** 2026-11-27. **Wayback:** http://web.archive.org/web/20261116215302/https://www.riotgames.com/en/terms-of-service (capture 2026-11-16)

Verbatim passages:

- Section 7.1 preamble:

  > "To be eligible to enjoy the Riot Services, you must comply with all laws and regulations in the jurisdiction in which you reside. You must also comply with the acceptable use and behavioral policies that we publish from time to time on our websites, apps and games and the behavioral rules listed below (collectively the "User Rules"). In case of a breach, we reserve the right to take appropriate disciplinary measures including temporary bans, account suspension or termination and deletion, hardware bans, removal of content, resets of user progress, chat-functionality limitations and matchmaking queue bans and restrictions to protect the integrity and spirit of the Riot Services, regardless of whether a specific behavior is listed in the User Rules as inappropriate."

- Item 7 (malicious software/interception):

  > "7. Transmitting, facilitating the transmission or use of any content that contains a virus, corrupted data, trojan horse, bot keystroke logger, worm, time bomb, cancelbot or other computer programming routines that are intended to and/or actually damage, detrimentally interfere with, surreptitiously intercept or mine, scrape or expropriate any system, data or personal info;"

- Item 8 (circumventing technical measures):

  > "8. Avoiding, bypassing, removing, deactivating, impairing, descrambling or otherwise circumventing any technological measure implemented by Riot or any third party to protect or control access to the Riot Services or any part thereof;"

- Item 11 (third-party programs — the clause most relevant to client-reading tools):

  > "11. Using any unauthorized third party programs, including mods, hacks, cheats, scripts, bots, trainers and automation programs that interact with the Riot Services in any way, for any purpose, including any unauthorized third party programs that intercept, emulate, or redirect any communication relating to the Riot Services and any unauthorized third party programs that collect info about the Riot Services by reading areas of memory used by the Riot Services to store info;"

- Item 12 (accessing non-public areas):

  > "12. Accessing or attempting to access areas of the Riot Services that are not made available to the public;"

- Item 15 (cheating/anticompetitive):
  > "15. Participating in cheating or other anticompetitive behavior, including but not limited to (a) playing on another person's account or otherwise engaging in activity intended to "boost" an account's status or rank and (b) "stream sniping," where a player's live broadcast is exploited to give another player an unfair advantage and/or harass the broadcaster and/or their teammates in game;"

### A6. Riot Engineering blog — what the LCU is

**Source:** https://engineering.riotgames.com/news/architecture-league-client-update — "May 16, 2016"
**Fetched:** 2026-11-27.

> "We chose to start again and build around Chromium Embedded Framework (CEF) as our front-end. … we built a microservice layer (still running on the player's desktop) to present the RTMP protocol as REST resources, to insulate the JavaScript from so much async. We used websockets to handle events back to the UI. We called this microservices layer the "foundation." … This allowed us to start building towards the vision of an "always available" client … The foundation only takes up around 20mb in memory … the foundation can bring up a system tray notification, even in the background, to indicate a game invite or a friend request."
> This is Riot's own description of the local client architecture the LCU exposes; it does not itself grant or deny third-party use.

### A7. Real-time in-game advice — the closest Riot policy language (TFT article; LoL analogue noted)

**Source:** https://support-developer.riotgames.com/hc/en-us/articles/22698732381587-Teamfight-Tactics — "August 12, 2024 19:39 Updated"
**Fetched:** live URL 403 on 2026-11-27; text from Wayback capture 2024-11-13: http://web.archive.org/web/20241113052028/https://support-developer.riotgames.com/hc/en-us/articles/22698732381587-Teamfight-Tactics

This is a **TFT** policy article, not League of Legends — quoted here because it is the only primary Riot text found that explicitly addresses real-time in-game recommendations:

> "### Examples of Unapproved Use Cases
> The following use cases will not be approved:
>
> - Scouting - tracking the champions opponents have on their boards.
> - Products that bypass a skill test for the player. Skill tests can include the tracking of diverse information over a short period of time.
> - Apps that provide dynamic, real-time information.
> - Apps that dictate player decisions."

> "## General Teamfight Tactics Policy
> The following policies apply to Teamfight Tactics:
>
> - Products that help players improve their skills over time are encouraged. Pre-game best practices or post-game analysis are great spaces for this.
> - Having a static recommendation for a player pre-game is acceptable, even if that same recommendation is available to you the entire game.
> - Issues arise when the recommendations adjust in real time based on the player's actions in game and give direct prescriptions of what to do.
> - …
> - Products may not provide information that was not available prior to the game. For example, an app can provide metadata on augment statistics as this information is available prior to the game and is not based on in-game activity. An app cannot make suggestions based on the player's current game state as that information is dynamic and not readily available prior to the game start.
> - …
> - Apps and overlays during the game may not include any real-time data that would improve a player's performance immediately by altering player behavior, such as "go here now" versus altering it upon reflection, learning and coaching the player game over game.
> - Apps and overlays during gameplay (including the loading screen) may not track your opponent's champions/plays or predict their next plays. …"

The **League of Legends** article (same policy family, updated 2025-03-11) contains the analogous but less explicit bullets already quoted in A2: "Products may not provide any game-session-specific information that would be previously unknown to the player" and "Apps that dictate player decisions." Source: https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends (live 403; Wayback http://web.archive.org/web/20251003175654/… same path).

### A8. Live Client Data API — documented endpoints and limitations

Same page as A2 (`developer.riotgames.com/league-client-apis.html`, `#game-client-api` / `#live-client-data-api`). Documented endpoints include `GET https://127.0.0.1:2999/liveclientdata/allgamedata`, `/activeplayer`, `/activeplayername`, `/eventdata`, `/playerlist`, `/gamestats`, `/playerlist`, plus a Swagger/OpenAPI spec at `https://127.0.0.1:2999/swagger/v3/openapi.json` and a downloadable root certificate (`riotgames.pem`). The page states the Game Client APIs "are only available locally for native applications" and that the client uses a self-signed certificate. No usage-limit, auth, or per-endpoint policy text appears in this section; the "not officially supported" disclaimer is attached to the **League Client API** subsection specifically. Whether the same disclaimer is intended for the Live Client Data API is not stated on the page (see Unverifiable items).

---

## B. API terms already in use (issue #181)

### B1. Developer Portal overview — key types and rate limits

**Source:** https://developer.riotgames.com/docs/portal — anchors `#api-keys`, `#development-api-keys`, `#personal-api-keys`, `#production-api-keys`
**Fetched:** live page is a JS SPA that did not render content on 2026-11-27; text from Wayback capture 2026-10-19: http://web.archive.org/web/20261019072501/https://developer.riotgames.com/docs/portal. Wayback for the page also: http://web.archive.org/web/20261111121253/https://developer.riotgames.com/docs/lol (same SPA).

Verbatim passages:

- Development keys:

  > "The API key that was generated for you when you signed into the developer portal is a development API key. These interim API keys are temporarily granted for products that are not meant for public consumption but benefit from temporary access to the API. … They also deactivate every 24 hours. You'll need to regularly reset yours to keep it live."

- Personal keys:

  > "You may apply for a personal API key by registering your product. Personal API keys should be used for products that are intended for just the developer or a small private community. These products can be registered without the verification process, but won't be approved for rate limit increases. You may request access to the Standard APIs, but not the Tournaments API. Personal keys require a detailed description of the product.
  > Acceptable uses for a personal API key include: bots for streaming sites, boards, voice com servers, etc.; to display your own personal stats for your personal website; personal projects to gather your own stats; personal research; projects meant for personal usage and not production
  > The rate limit for a personal keys is by design very limited:
  >
  > - 20 requests every 1 second
  > - 100 requests every 2 minutes
  >   Note that rate limits are enforced per region. …
  >   You may not run your application for public consumption using a personal key, regardless of how long the approval process for your production key takes. Note that public consumption includes open alpha/beta tests."

- Production keys:

  > "If you have developed an application using the Riot Games API that you would like to open up to players, you should apply for a production API key. You may not maintain a public product with a development API key. …
  > The starting rate limit of a production API key is much larger than the development key:
  >
  > - 500 requests every 10 seconds
  > - 30,000 requests every 10 minutes
  >   …
  >   If you are working on multiple projects, you should register each one separately and each one needs to be individually approved for a separate production API key."

- Registration requirement:

  > "First off, every product owner (developer) will be expected to have read and understood our policies. … Even if your product doesn't use the Riot Games API, you'll find it beneficial to register your product. … When reviewing applications we take a look at a lot of factors … we want to make sure that the product helps players in some measurable way. We want to see product that help players get better at our games, or track their growth. What we don't want to see are products that solve our games or make everything too simple."

- Key security:
  > "As a final note on API keys, it's important to mention that your key will likely end up revoked if it isn't properly secured. Securing your API key is a requirement to publishing a project as outlined in the General Policies. If we determine that your key is not secured appropriately, we'll take action to secure it for you. :)"

### B2. Rate limiting mechanics (legacy doc page, archived)

**Source:** https://developer.riotgames.com/rate-limiting.html (old portal page; current docs SPA does not expose a static rate-limiting page — see Unverifiable items)
**Fetched:** live URL no longer serves this page; text from Wayback capture 2019-06-29: http://web.archive.org/web/20190629194440/https://developer.riotgames.com/rate-limiting.html

Verbatim passages:

> "There are three types of limits used in the API infrastructure - application, method and service rate limits."
> "The first type of limit is enforced on a per API key basis and is called an application rate limit. App rate limits are enforced per region. Every call made to any Riot Games API endpoint in a given region counts against the app rate limit for that key in that region, except where noted on the API Reference page. For example, calls to the static data API do not count against the app rate limit."
> "If a call exceeds the app or service rate limit for a given period of time, then subsequent calls made to limited endpoints will return a 429 "Rate limit exceeded" HTTP response until the rate limit expires. …"
> "While it is our policy not to reveal the specifics of how our rate limiting works, you can assume for the purposes of your code that the bucket starts when you make your first API call."

Note: the repo's `docs/RIOT_API.md` already records method-level limits observed from live response headers on 2026-11-12 (e.g., match-v5 `2000:10`, league-v4/champion-mastery-v4 STD `20000:10,1200000:600`, account-v1 `1000:60`) and the app-level envelope of 20 req/s + 100 req/2 min per region for the personal key.

### B3. Data Policies (archived portal page)

**Source:** https://developer.riotgames.com/policies/data-policies.html — "Last Updated" stamps of Aug 18, 2017 per section.
**Fetched:** archived only; Wayback capture 2019-08-20: http://web.archive.org/web/20190820164739/https://developer.riotgames.com/policies/data-policies.html. Whether this page still exists on the current portal could not be verified (current Policies nav lists only General / Game Specific / Riftbound).

Verbatim passages:

> "#### AGGREGATED STATISTICS … Developers may display aggregated statistics to provide win rates, KDA, or other measures of their performance, however queues used to aggregate these stats **must be clearly identified**. … If you're showing stats for a player's recent games, you must indicate the stats were generated from every queue."
> "We never allow shaming based on a player's performance … You may choose to honor or glorify a player based on their performance, but we don't allow for projects to make assumptions that could lead to negative preconceptions about a player (i.e., tilted, toxic, feeder, etc.)."
> "#### CUSTOM LADDERS OR CHALLENGES … Custom ladders or ranking systems may be created as long as they aren't replacements for official Riot systems. … Destroying the Nexus should always remain the primary intent of the game. A challenge or contest whose goal is anything other than achieving a victory is strictly forbidden."

### B4. Legal Jibber Jabber (fan-project / IP policy)

**Source:** https://www.riotgames.com/en/legal — "Last Updated: August 2018"
**Fetched:** 2026-11-27. **Wayback:** http://web.archive.org/web/20261115034304/https://www.riotgames.com/en/legal (capture 2026-11-15)

Verbatim passages:

> "1. What can I develop with Riot's IP? … on the condition that you follow all of the rules described in this policy (the "Rules") and the Terms of Use, Riot Games ("Riot" or "We") grants you a personal, non-exclusive, non-sublicenseable, non-transferable, revocable, limited license for you to use, display and create derivative works based upon Riot's IP, strictly for noncommercial (except as specifically provided below) community use. We reserve the right to deny anyone the use of our IP at any time, for any reason or no reason …"

> "2. No commercial projects (except…) … You may not create commercial Projects, including any Project that crowdsources any portion of its funding, any Project that involves a business or legal entity, or any Project where you gate the content with a paywall … without a written license agreement from us. … Exception 3: API Dev Terms and Policies — We permit commercial Projects that both (1) comply with our API Terms and API Policies; and (2) use a currently valid Riot API key that we granted to you specifically for your Project. … If we revoke your API key for any reason, you must immediately shut down your Project."

> "3. No unauthorized games or apps. … Please do not take any part of our IP (e.g., character appearance, character abilities, maps, icons, items, etc.) and use it in a game or app. … we do not allow any Projects on the Apple Store or Google Play Store unless they have either a written license agreement from us or a valid Riot API key and comply with our API Terms and Policies."

> "5. Can I use Riot's logos or trademarks? … Unless you have a written license agreement with us, you may not use any of our logos or trademarks anywhere in your Project or on any website, advertising material, video, or other publication. You may not register domain names, social media accounts, or similar stuff that uses Riot Games or any of our trademarks, trade names, character names, etc. …"

> "6. Can I share my Project with the community? … If you share your Project with others, please conspicuously include the following notice (e.g., on your Project's website): [The title of your Project] was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."

### B5. Riot Developer Relations FAQ articles (support-developer.riotgames.com)

All fetched via Wayback on 2026-11-27 (live support-developer URLs return HTTP 403 to automated fetches; content verified against Wayback captures).

- **FAQs: The Basics** (updated 2023-12-04) — http://web.archive.org/web/20251012010822/https://support-developer.riotgames.com/hc/en-us/articles/22801164172051-FAQs-The-Basics

  > "### What is the difference between a Personal Key and a Production Key? Personal keys are meant for smaller-size, personal projects, such as testing the API, products for yourself and a small group, or for creating prototypes to later submit for a production key. … Production keys are meant for larger-size, professional projects. For production keys, we need to see a functioning website/application or a prototype that demonstrates you'll be able to fully execute on your use case."

- **Production Key Applications** (updated 2023-12-04) — search-result snippet + same section; Wayback: http://web.archive.org/web/20251012010822/…/articles/22801383038867-Production-Key-Applications

  > "Production keys are reserved for fully functioning applications that can clearly demonstrate their user flows. We need to see a website to understand what your app does, view your Terms of Service and Privacy Policy, and to make sure your app is in a good state for a production key. … ### Can I submit my Github for a production key? No. Unfortunately, we are unable to accept Github repositories and source code in lieu of a functioning application/site."

- **Using Multiple Applications** (updated 2023-11-10) — http://web.archive.org/web/20251012015032/https://support-developer.riotgames.com/hc/en-us/articles/22801284198035-Using-Multiple-Applications
  > "### Am I allowed to have multiple applications? Yes, you can have one application per game per product. This means if you have one product/website, you can have up to four applications (one for each game we offer), plus one RSO client. … Please note you may NOT have multiple applications to bypass rate limits.
  >
  > ### Am I allowed to use a single API key for multiple applications? No, only one product/website per API key is allowed. Your API key is approved only for the use case and game within your description."

### B6. Data Dragon / CommunityDragon asset rules

- **Data Dragon** is documented inside the Developer API Policy page (`developer.riotgames.com/league-client-apis.html`, `#data-dragon` / `#data-assets`): "Data Dragon is our way of centralizing League of Legends game data and assets, including champions, items, runes, summoner spells, profile icons, and static game data." It provides data files (JSON) and image assets; usage rights flow through the API Terms + General Policies asset whitelist ("Game-Specific static data" / "Data Dragon" listed as permitted assets) and the Legal Jibber Jabber fan-project license. No separate Data Dragon-specific license text was found on the developer portal pages fetched.

- **CommunityDragon** — https://communitydragon.org/ — fetched 2026-11-27. Wayback: http://web.archive.org/web/20260728161640/https://communitydragon.org/ (capture 2026-07-28).
  > "CommunityDragon was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."
  > CommunityDragon is a **fan-maintained project, not a Riot source**. Its docs (https://github.com/communitydragon/docs/blob/master/assets.md, fetched 2026-11-27; Wayback http://web.archive.org/web/20260721085312/…) document file paths for raw game data exported from game client files ("On raw.communitydragon.org, LCU files are exported at the root and game client hashes are exported in the game/ subdirectory") but contain **no license or redistribution terms of its own** — it inherits whatever rights exist under Riot's Legal Jibber Jabber. Whether CD's republication of raw client files is itself sanctioned by Riot is not stated anywhere on the site (UNVERIFIED).

### B7. Trademark / non-affiliation

Covered by: API Terms `#definitions` ("Riot Marks means Riot Games®, League of Legends®, and all other trade names, trademarks … of Riot"), Legal Jibber Jabber §5 (no logos/trademarks without written license), and the required boilerplates quoted in A2/B-notes ("[Your Product Name] is not endorsed by Riot Games…" / "…was created under Riot Games' "Legal Jibber Jabber" policy… Riot Games does not endorse or sponsor this project."). The Riot press kit is listed under General Policies as a permitted asset source for logos "limited to those cases where such use is inevitable to serve the core value of the product."

---

## Assessment inputs (facts only — no verdict)

Mapping the quoted text to the project's planned uses. **This is not a GO/NO-GO; the owner decides.**

**(a) Reading the LCU (`https://127.0.0.1:2999` client API + lockfile WebSocket):**

- Riot explicitly documents the LCU for third-party awareness but labels it "not officially supported for use with third party applications" with "no guarantees of full documentation, service uptime, or change communication" (A2).
- Riot requires developers using it to "create a new application or leave a note on your existing application in the Developer Portal" and to disclose "which endpoints you're using and how you're using them" (A2); General Policies add "Register your product through the Developer Portal" if the product utilizes the LCU (A4).
- The Jan 2019 DevRel post states "Before you release an application … that uses the League Client API in any region, you must contact us" and "Only endpoints on our approved list are allowed" (A3); the currently published page does not itself reproduce an endpoint allow-list — whether one still exists/where it lives could not be verified.
- ToS §7.1 item 12 prohibits "Accessing or attempting to access areas of the Riot Services that are not made available to the public" and item 11 prohibits "unauthorized third party programs … that interact with the Riot Services" — whether a read-only local HTTPS client counts as "unauthorized" when Riot separately documents the API is the central ambiguity (see Unverifiable).
- Vanguard FAQ (Apr 2024): "Apps developed using the LCU and in-game APIs are still expected to work" but "the LCU and in-game APIs are not owned by Developer Relations and we cannot offer support or guarantee updates" (A3).

**(b) Reading the Live Client Data API:**

- Documented on the developer portal under Game Client API: "only available locally for native applications", "provides a method for gathering data during an active game" (A2/A8). Self-signed cert with a published root cert.
- The "not officially supported" NOTE sits under the League Client API heading; the Live Client Data API section carries no equivalent disclaimer on the current page — whether the disclaimer is intended to cover it is not stated (UNVERIFIED).
- Same Game Integrity constraints apply to any product consuming it (A2 bullets).

**(c) Real-time in-game advice:**

- LoL Game Policy unapproved list: "Products may not provide any game-session-specific information that would be previously unknown to the player" and "Apps that dictate player decisions" (A2).
- Game Integrity: products "should not remove game decisions, but may highlight decisions that are important and give multiple choices"; must not "create an unfair advantage" (A2/A4).
- The TFT policy article is the most explicit Riot text on this exact feature class: static pre-game recommendations OK "even if that same recommendation is available to you the entire game"; "Issues arise when the recommendations adjust in real time based on the player's actions in game and give direct prescriptions of what to do"; "Apps that provide dynamic, real-time information" are unapproved; in-game overlays "may not include any real-time data that would improve a player's performance immediately by altering player behavior" (A7). Whether Riot intends the TFT wording to govern LoL tools is not stated — it is a different game's policy.
- LCU 2019 "not for" list (historical, no longer on live page): "Don't create commentary on another player's performance"; "Manipulate or mislead players" (A2, Wayback).

**(d) Current ETL usage (match-v5, league-v4, champion-mastery-v4, Data Dragon, CommunityDragon):**

- Key type: personal key for "products that are intended for just the developer or a small private community"; limits 20 req/s + 100 req/2 min per region; "You may not run your application for public consumption using a personal key" (B1). DraftOrb is registered on the portal as a personal product (per `docs/RIOT_API.md`, owner-verified 2026-11-12).
- API Terms: no clause found explicitly banning scheduled/automated use within limits, storing derived aggregates, or serving derived data in a local tool; the binding constraints found are "reasonable request volume or constitutes excessive or abusive use" (A1) and the termination-triggered obligation to "delete all of the Game Information in Your possession" (A1).
- Publishing derived aggregate statistics is addressed by the (archived) Data Policies: aggregates "must be clearly identified" by queue and must not enable player shaming (B3) — relevant to the anonymized aggregate JSON the ETL publishes.
- Data Dragon assets: permitted under the API asset whitelist ("Game-Specific static data"/"Data Dragon") and the fan-project license; CommunityDragon is fan-run under Legal Jibber Jabber with no redistribution terms of its own (B6).

**(e) Sharing the app with other players:**

- Personal key cannot serve public consumption, "including open alpha/beta tests" (B1); production key required for public products, which requires a working site/prototype, ToS and Privacy Policy, and Riot review (B1, B5); production key rate limits 500 req/10 s + 30,000 req/10 min per region.
- "Only one product/website per API key"; one product may have up to four game applications + one RSO client; no multiple applications to bypass rate limits (B5); "If you are working on multiple projects, you should register each one separately" (B1).
- Key must never ship in distributed binaries; production keys get revoked if improperly secured (B1, A4). API Terms: "You may not sell, transfer, sublicense or otherwise disclose Your API Key(s) to any other party" (A1).
- Legal Jibber Jabber: commercial Projects need API Terms compliance + a valid Riot API key granted for that project; key revocation ⇒ "you must immediately shut down your Project" (B4).
- GDPR: Riot forwards end-user deletion requests (identifiers) to all active developers (A1) — relevant if profiles/aggregates ever contain personal data of other players.

---

## Could NOT verify from a primary source

1. **Whether LCU and/or Live Client Data endpoints are "Riot Games API" under the API Terms definition** ("currently accessible through the Riot Developer Site"). The local endpoints are documented on the developer site but are not keyed API calls; the terms' scope clause does not explicitly address localhost APIs.
2. **Whether reading local client data without memory access or injection is treated differently from game modification.** No primary Riot text found that explicitly distinguishes "local read-only client API" from prohibited conduct. The ToS prohibits "unauthorized third party programs … that interact with the Riot Services" and memory-reading programs; the Vanguard FAQ says overlays using "the API, game client, and in-game APIs should continue to function" — but does not define which local reads are sanctioned.
3. **Whether the "approved list" of LCU endpoints referenced in the Jan 2019 DevRel post still exists and where it is published.** The current `league-client-apis.html` page contains no endpoint allow-list.
4. **Whether the "not officially supported" disclaimer is intended to cover the Live Client Data API.** It appears only under the League Client API heading; the Game Client API / Live Client Data sections carry no equivalent note.
5. **Whether the TFT real-time-recommendation policy language applies to League of Legends products.** It is published under the TFT game policy; the LoL policy uses different, less explicit wording. No Riot statement found extending one game's policy to another.
6. **Current live rate-limiting documentation.** The old `rate-limiting.html` page is archived only; the current docs are JS-rendered and expose limits via the API reference/key pages. App-level numbers (20/1 s, 100/2 min personal; 500/10 s, 30,000/10 min production) come from the portal docs capture; method-level numbers come from observed response headers (repo-verified 2026-11-12).
7. **Whether the 2019 "What it's for / What it's not for" LCU lists still represent current policy.** They were removed from the live page between 2019 and 2026-11-27; no Riot statement found explaining the removal.
8. **Data retention/deletion schedule for stored Game Information.** API Terms require deletion upon termination and GDPR erasure forwarding; no fixed retention period for derived aggregates was found.
9. **CommunityDragon's own licensing/redistribution terms.** The site states it operates under Riot's Legal Jibber Jabber but publishes no separate terms governing reuse of its exports.
10. **Whether personal keys expire.** Portal docs state development keys "deactivate every 24 hours"; no expiry statement for personal keys was found on the captured portal page (repo notes say they persist until revoked — consistent but not quoted from a primary source here).
11. **support-developer.riotgames.com live access.** The Zendesk help center returned HTTP 403 to automated fetches on 2026-11-27; all quotes from that domain come from Wayback captures dated 2024–2026 and should be re-verified by the owner in a browser.
