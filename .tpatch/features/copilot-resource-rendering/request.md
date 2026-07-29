# Feature Request: Render rich content inline in the chat timeline. Display image_view items as inline images (data URL from base64+mimeType), audio items as HTML5 audio players, and resource/file items as clickable links. The data is already extracted by copilot-resource-events into item.completed payloads — this feature adds the frontend components in MessagesTimeline.tsx to render them. Follow the existing pattern for user attachment image rendering (grid layout, zoom preview). Depends on copilot-resource-events.

**Slug**: `copilot-resource-rendering`
**Created**: 2026-04-23T18:22:48Z

## Description

Render rich content inline in the chat timeline. Display image_view items as inline images (data URL from base64+mimeType), audio items as HTML5 audio players, and resource/file items as clickable links. The data is already extracted by copilot-resource-events into item.completed payloads — this feature adds the frontend components in MessagesTimeline.tsx to render them. Follow the existing pattern for user attachment image rendering (grid layout, zoom preview). Depends on copilot-resource-events.
