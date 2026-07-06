# MargeloChat

A ChatGPT-style mobile chat app with a twist: it knows about **Margelo**. You talk to a streaming AI assistant that renders replies as live markdown, shows its reasoning, and answers any question about Margelo (the company, its people, and its open-source libraries) by searching a real knowledge base instead of guessing.

Ask it anything. For general questions it just replies; for Margelo questions it calls a retrieval tool, pulls matching facts from a vector database, and answers only from what it found.

## How it works

- **Brain** — OpenAI's Responses API, streamed over a **WebSocket** ([`react-native-nitro-websockets`](https://github.com/mrousavy/nitro)) rather than HTTP. Reply text and reasoning summaries stream token-by-token; turns are chained with `previous_response_id` so the model remembers the conversation.
- **Knowledge base (RAG)** — the model can call a `search_margelo_kb` tool, which queries a [Pinecone](https://www.pinecone.io/) index (integrated embedding, so raw text goes up and Pinecone embeds it server-side) over [`react-native-nitro-fetch`](https://github.com/margelo/react-native-nitro-fetch). Margelo questions are answered from the retrieved context, never from the model's memory.
- **Rendering** — replies render as native markdown with a streaming animation and tappable links ([`react-native-enriched-markdown`](https://github.com/software-mansion-labs/react-native-enriched-markdown)). The collapsible "thought process" opens in a bottom sheet ([`react-native-true-sheet`](https://github.com/lodev09/react-native-true-sheet)).
- **List** — a keyboard-aware [`@legendapp/list`](https://github.com/LegendApp/legend-list) with anchored end-space, for ChatGPT-style scroll and anchor behavior while a reply streams in.
- **Look** — real Liquid Glass surfaces on iOS 26+ ([`@callstack/liquid-glass`](https://github.com/callstack/liquid-glass)) with plain fallbacks everywhere else, a Skia shimmer "Thinking" label ([`@shopify/react-native-skia`](https://github.com/Shopify/react-native-skia)), and SF Symbols that fall back to Material Design Icons on Android.
- **Attachments** — pick images ([`react-native-image-picker`](https://github.com/react-native-image-picker/react-native-image-picker)), sent to the model as base64 data URLs and shown as thumbnails ([`react-native-nitro-image`](https://github.com/mrousavy/react-native-nitro-image)).

## Requirements

Runs on **iOS and Android** (New Architecture). Liquid Glass needs **iOS 26+**; on older iOS and on Android those surfaces fall back to a plain rounded style.

- Xcode + CocoaPods, Node `>= 22.11`, and the [React Native environment](https://reactnative.dev/docs/set-up-your-environment).
- An **OpenAI API key** and a populated **Pinecone index** for the knowledge-base tool.

> **Note:** this is a demo. The API keys live in the app bundle, which is fine locally but unsafe for production — anyone can extract them. For anything real, put a relay server in front and keep the keys server-side.

## Setup

```sh
npm install
cp src/config.example.ts src/config.ts   # then fill in your keys
cd ios && pod install && cd ..
```

Open `src/config.ts` and add your OpenAI key, Pinecone key, and index host. This file is gitignored and never committed.

## Run

```sh
npm start          # Metro
npm run ios        # build + launch on the iOS simulator/device
npm run android    # build + launch on the Android emulator/device
```

Other scripts:

```sh
npm run lint       # eslint
npm test           # jest
```

## Project structure

```
src/
  config.ts                 # API keys (gitignored; copy from config.example.ts)
  theme.ts                  # dark theme + shared markdown design tokens
  markdownStyle.ts          # maps the theme onto the markdown renderer
  notImplemented.ts         # "demo only" alert for stubbed controls
  openai/
    protocol.ts             # builds Responses API requests, parses server events
    useOpenAIConnection.ts  # WebSocket lifecycle + reconnect with backoff
  rag/
    searchKnowledgeBase.ts  # Pinecone knowledge-base search (the model's tool)
  hooks/
    useChat.ts              # chat state, streaming, and the tool-call loop
    useAttachments.ts       # image picking
    useHideBootSplashOnLayout.ts
  screens/
    RootDrawer.tsx          # pager: recents <-> chat
    ChatScreen.tsx          # the conversation, list, and composer wiring
    RecentsScreen.tsx       # chat history (mocked for the UI pass)
  components/
    Composer.tsx            # the input pill (grow/shrink, attachment thumbnails)
    MessageBubble.tsx       # user bubble / assistant markdown + reasoning trace
    ReasoningSheet.tsx      # bottom sheet showing the thinking trace
    ShimmerText.tsx         # Skia shimmer "Thinking" label
    Header.tsx              # top bar
    Glass.tsx               # Liquid Glass wrapper with a plain fallback
    Icon.tsx                # SF Symbol with a Material Design Icon fallback
    EmptyState.tsx          # centered logo before the first message
    ScrollToBottomButton.tsx
```


### Open-source libraries

This app stands on the shoulders of these projects (thank you to their authors):

- [react-native](https://github.com/facebook/react-native) & [react](https://github.com/facebook/react) — Meta
- [react-native-nitro-modules](https://github.com/mrousavy/nitro) — Marc Rousavy
- [react-native-nitro-websockets](https://github.com/mrousavy/nitro) — Marc Rousavy
- [react-native-nitro-image](https://github.com/mrousavy/react-native-nitro-image) — Marc Rousavy
- [react-native-nitro-fetch](https://github.com/margelo/react-native-nitro-fetch) & [react-native-nitro-text-decoder](https://github.com/margelo/react-native-nitro-fetch) — Szymon Kapała / Margelo
- [react-native-nitro-symbols](https://github.com/DaveyEke/react-native-nitro-symbols) — Dave Mkpa Eke ([@DaveyEke](https://github.com/DaveyEke))
- [react-native-reanimated](https://github.com/software-mansion/react-native-reanimated) & [react-native-worklets](https://github.com/software-mansion/react-native-reanimated) — Software Mansion
- [react-native-keyboard-controller](https://github.com/kirillzyusko/react-native-keyboard-controller) — Kiryl Ziusko
- [@legendapp/list](https://github.com/LegendApp/legend-list) — LegendApp
- [react-native-enriched-markdown](https://github.com/software-mansion-labs/react-native-enriched-markdown) — Software 
- [react-native-true-sheet](https://github.com/lodev09/react-native-true-sheet) — Jovanni Lo
- [@shopify/react-native-skia](https://github.com/Shopify/react-native-skia) — Shopify
- [@callstack/liquid-glass](https://github.com/callstack/liquid-glass) — Oskar Kwaśniewski / Callstack
- [react-native-pager-view](https://github.com/callstack/react-native-pager-view) — Callstack
- [@react-native-menu/menu](https://github.com/react-native-menu/menu) — Jesse Katsumata
- [@react-native-vector-icons/material-design-icons](https://github.com/oblador/react-native-vector-icons) — Joel Arvidsson
- [react-native-image-picker](https://github.com/react-native-image-picker/react-native-image-picker) — community
- [react-native-safe-area-context](https://github.com/AppAndFlow/react-native-safe-area-context) — Janic Duplessis / 
- [react-native-bootsplash](https://github.com/zoontek/react-native-bootsplash) & [react-native-edge-to-edge](https://github.com/zoontek/react-native-edge-to-edge) — Mathieu Acthernoene
- Vector database: [Pinecone](https://www.pinecone.io/) · Model API: [OpenAI](https://openai.com/)
