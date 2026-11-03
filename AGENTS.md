# Guide pour les agents

Ce fichier s'adresse aux agents de code (Cursor, Claude Code, Codex…) qui travaillent dans ce dépôt.

## Le projet

`mcp-contexte-gpt` est un serveur MCP local (transport stdio) qui importe des conversations ChatGPT dans les clients MCP. Il utilise les API privées de l'application web ChatGPT, en lecture seule (requêtes GET uniquement).

URLs prises en charge :

```text
https://chatgpt.com/c/{conversation_id}
https://chatgpt.com/share/{share_id}
https://chatgpt.com/share/e/{share_id}
https://chatgpt.com/g/{project_slug}/c/{conversation_id}
https://chatgpt.com/g/{project_slug}/shared/c/{conversation_id}?owner_user_id={owner_id}
```

`chat.openai.com` est accepté pour tous ces chemins.

- Partages : `backend-api/share/{share_id}`, token facultatif, mis en cache sous `share-{share_id}`.
- Projets : `backend-api/conversations/{id}` avec l'en-tête `chatgpt-project-id`, plus `chatgpt-conv-owner-id` si `owner_user_id` est présent (obligatoire pour `/shared/c/`). Token obligatoire.

N'ajoutez pas d'export en masse, de téléchargement de pièces jointes ni d'automatisation du navigateur sans validation explicite de l'utilisateur.

## Structure

```text
src/main.ts                         Point d'entrée (charge le fichier env, démarre en stdio)
src/config/env-file.ts              Fichier d'environnement de secours
src/mcp/server.ts                   Déclaration des outils et ressources MCP
src/mcp/instructions.ts             Instructions envoyées au client MCP
src/mcp/tools/                      Un fichier par outil MCP
src/providers/chatgpt/              url-parser, auth, chatgpt-client, shared-conversation, types
src/rendering/                      conversation-messages, markdown-renderer, context-packer
src/storage/                        cache-paths, workspace-cache, conversation-store, cache-index, content-hash
src/shared/                         errors (AppError), format-date
tests/                              Un fichier de test par module
```

## Conventions

- Code, noms de fichiers, fonctions et messages d'erreur en anglais ; fichiers en kebab-case.
- Documentation (`README.md`, ce fichier) en français.
- Les erreurs passent par `AppError` (`src/shared/errors.ts`), avec un `error_code` stable.
- Les noms des outils MCP (`import_chatgpt_url`, etc.) et les champs des réponses font partie de l'API : ne les renommez pas sans raison.
- Les messages suivent la branche affichée (`current_node`). La troncature garde les métadonnées et les messages les plus récents, dans tous les formats.
- Incrémentez `CACHE_FORMAT_VERSION` (`src/storage/conversation-store.ts`) à chaque changement du rendu Markdown ou des messages.
- Si vous changez une variable d'environnement, un chemin de cache ou un outil MCP, mettez à jour `README.md` et les tests.

## Commandes obligatoires

Avant de terminer une modification :

```bash
npm run check
```

Cette commande lance `npm test`, `npm run typecheck` et `npm run build`. Les tests simulent `fetch` : ils ne doivent jamais nécessiter de vrai token ni d'accès réseau à ChatGPT.

## Configuration locale

Variables : `CHATGPT_BEARER_TOKEN`, `CHATGPT_ACCOUNT_ID`, `MCP_CONTEXTE_GPT_CACHE_DIR`, `MCP_CONTEXTE_GPT_ENV_FILE`, `MCP_CONTEXTE_GPT_WORKSPACE`.

Sans `MCP_CONTEXTE_GPT_CACHE_DIR`, le cache est `~/.cache/mcp-contexte-gpt/workspaces/<id>/`, un dossier par `cwd` (ou par `MCP_CONTEXTE_GPT_WORKSPACE`). Au démarrage, `prepareWorkspaceCache` supprime les caches dont le dossier de travail n'existe plus. `MCP_CONTEXTE_GPT_CACHE_DIR` désactive ce rangement et ce nettoyage.

Fichier de secours par défaut : `~/.config/mcp-contexte-gpt/env`. Les variables déjà présentes dans l'environnement restent prioritaires.

Commande du serveur pour un client MCP : `node <chemin-du-depot>/dist/src/main.js` (après `npm run build`).

## Sécurité

- N'affichez, ne journalisez, ne commitez et ne répétez jamais un bearer token.
- N'utilisez pas de vrais identifiants de conversation ni de vraies données privées dans les exemples et les tests.
- Le cache est en clair et peut contenir des données sensibles.
- Conservez l'avertissement sur les API non officielles dans le README.
- Écrivez tous les logs sur stderr : stdout est réservé au protocole MCP.
