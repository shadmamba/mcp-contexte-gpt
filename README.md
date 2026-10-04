# mcp-contexte-gpt

Serveur MCP local qui importe vos conversations ChatGPT dans Claude Code, Cursor, Codex ou tout autre client MCP.

Donnez une URL ChatGPT à votre agent : il récupère la conversation (plan, code, décisions) et peut continuer le travail dans votre dépôt sans copier-coller.

## Avertissement

Projet non officiel, sans lien avec OpenAI.

Il utilise les API privées de l'application web ChatGPT. Elles ne sont pas documentées et peuvent changer, casser ou renvoyer des données incomplètes à tout moment. Ce projet est destiné à un usage personnel : migration de contexte et expérimentation MCP en local.

Aucune garantie n'est donnée. Vous êtes responsable de votre usage : gestion du token, confidentialité des données, conditions d'utilisation de ChatGPT et politique de votre organisation. Le bearer token est un identifiant sensible : traitez-le comme un mot de passe.

## Fonctionnalités

- Import de conversations privées, de liens de partage publics et de conversations de projets ChatGPT.
- Suit la branche affichée dans ChatGPT : si vous avez modifié un message ou régénéré une réponse, c'est la version visible qui est importée.
- Rafraîchit le contenu distant à chaque import et ne réécrit le cache que si la conversation a changé.
- Cache local en Markdown, JSON et liste de messages, consultable sans réseau.
- Troncature cohérente : quand la conversation dépasse la limite, les métadonnées et les messages les plus récents sont conservés, et le JSON reste valide.
- Fonctionne de la même façon sous Windows, macOS et Linux.

## URLs prises en charge

```text
https://chatgpt.com/c/{conversation_id}
https://chatgpt.com/share/{share_id}
https://chatgpt.com/share/e/{share_id}
https://chatgpt.com/g/{project_slug}/c/{conversation_id}
https://chatgpt.com/g/{project_slug}/shared/c/{conversation_id}?owner_user_id={owner_id}
```

Le domaine `chat.openai.com` est accepté pour tous ces chemins.

| Type d'URL | Token | Remarques |
| --- | --- | --- |
| `/c/{id}` | Obligatoire | Conversation privée |
| `/share/{id}`, `/share/e/{id}` | Facultatif | Mise en cache sous l'identifiant `share-{share_id}` |
| `/g/{project_slug}/c/{id}` | Obligatoire | Conversation d'un projet ; `owner_user_id` facultatif |
| `/g/{project_slug}/shared/c/{id}` | Obligatoire | Conversation partagée dans un projet ; `owner_user_id` obligatoire |

`{project_slug}` doit commencer par l'identifiant du projet (`g-p-` suivi de 32 caractères hexadécimaux), tel qu'il apparaît dans la barre d'adresse de ChatGPT.

Hors périmètre : export en masse de l'historique ou d'un projet, téléchargement des pièces jointes, images ou Canvas, automatisation du navigateur.

## Installation

Prérequis : Node.js 20 ou plus récent.

```bash
git clone https://github.com/shadmamba/mcp-contexte-gpt.git
cd mcp-contexte-gpt
npm install
npm run build
```

Le serveur se lance avec `node <chemin-du-depot>/dist/src/main.js`.

## Configuration du token

1. Ouvrez [chatgpt.com](https://chatgpt.com) dans votre navigateur, puis les outils de développement (F12), onglet Réseau.
2. Rechargez la page et sélectionnez une requête vers `backend-api`.
3. Copiez la valeur de l'en-tête `Authorization`, sans le préfixe `Bearer `.

Ne collez jamais ce token dans une conversation avec un agent, et ne le commitez jamais.

Au démarrage, le serveur lit un fichier d'environnement de secours. Les variables déjà définies dans l'environnement du processus restent prioritaires.

**macOS / Linux** :

```bash
mkdir -p ~/.config/mcp-contexte-gpt
chmod 700 ~/.config/mcp-contexte-gpt
cat > ~/.config/mcp-contexte-gpt/env <<'EOF'
export CHATGPT_BEARER_TOKEN="<votre-token>"
export CHATGPT_ACCOUNT_ID=""
EOF
chmod 600 ~/.config/mcp-contexte-gpt/env
```

**Windows (PowerShell)** :

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\mcp-contexte-gpt" | Out-Null
@'
export CHATGPT_BEARER_TOKEN="<votre-token>"
export CHATGPT_ACCOUNT_ID=""
'@ | Set-Content -Encoding utf8 "$env:USERPROFILE\.config\mcp-contexte-gpt\env"
```

Le fichier accepte `export CLE="valeur"`, `CLE=valeur` et les commentaires `#`.

### Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `CHATGPT_BEARER_TOKEN` | Token de l'application web ChatGPT. |
| `CHATGPT_ACCOUNT_ID` | Identifiant de compte, utile pour les comptes Team et Enterprise si la détection automatique échoue. |
| `MCP_CONTEXTE_GPT_CACHE_DIR` | Dossier du cache (par défaut `~/.cache/mcp-contexte-gpt`). |
| `MCP_CONTEXTE_GPT_ENV_FILE` | Chemin d'un autre fichier d'environnement (par défaut `~/.config/mcp-contexte-gpt/env`). |

## Configuration des clients MCP

Remplacez `<chemin-du-depot>` par le chemin absolu du dépôt.

### Claude Code

```bash
claude mcp add contexte-gpt -- node <chemin-du-depot>/dist/src/main.js
```

Ou dans la configuration JSON :

```json
{
  "mcpServers": {
    "contexte-gpt": {
      "command": "node",
      "args": ["<chemin-du-depot>/dist/src/main.js"]
    }
  }
}
```

### Cursor

Dans `~/.cursor/mcp.json` (pour tous vos projets) ou `.cursor/mcp.json` (pour un seul projet) :

```json
{
  "mcpServers": {
    "contexte-gpt": {
      "command": "node",
      "args": ["<chemin-du-depot>/dist/src/main.js"]
    }
  }
}
```

### Codex

Dans `~/.codex/config.toml` :

```toml
[mcp_servers.contexte_gpt]
command = "node"
args = ["<chemin-du-depot>/dist/src/main.js"]
startup_timeout_sec = 10
tool_timeout_sec = 120
```

Redémarrez le client après avoir modifié sa configuration.

## Utilisation

Exemple de demande à votre agent :

```text
Importe https://chatgpt.com/c/<id> puis vérifie si le code proposé
dans cette conversation est déjà présent dans src/ ; sinon, applique-le.
```

### Outils MCP

| Outil | Réseau | Rôle |
| --- | --- | --- |
| `import_chatgpt_url` | Oui | Récupère la conversation, met à jour le cache si elle a changé et renvoie le contexte. Paramètres : `url`, `format` (`markdown`, `messages` ou `json`), `max_chars` (30000 par défaut), `cache_policy` (`refresh` ou `cache_only`). |
| `get_chatgpt_context` | Non | Lit une conversation déjà importée. Pour un partage, utilisez `share-{share_id}` comme `conversation_id`. |
| `list_chatgpt_imports` | Non | Liste les conversations en cache, avec une recherche texte facultative. |
| `verify_chatgpt_auth` | Oui | Vérifie que le token est présent, non expiré et accepté par ChatGPT. |

### Ressources MCP

Lecture directe du cache, sans réseau :

```text
chatgpt://conversation/{conversation_id}/markdown
chatgpt://conversation/{conversation_id}/messages
chatgpt://conversation/{conversation_id}/json
chatgpt://conversation/{conversation_id}/metadata
```

## Cache et confidentialité

Les conversations importées sont enregistrées **en clair** dans `~/.cache/mcp-contexte-gpt/` (ou dans `MCP_CONTEXTE_GPT_CACHE_DIR`). Elles peuvent contenir des prompts privés, du code et d'autres données sensibles. Supprimez ce dossier pour effacer le cache.

Le serveur n'écrit jamais le token sur le disque et ne l'inclut jamais dans ses réponses.

## Dépannage

**`verify_chatgpt_auth` échoue**
- Vérifiez que `CHATGPT_BEARER_TOKEN` est bien défini, dans l'environnement ou dans le fichier `env`.
- Le token expire régulièrement : récupérez-en un nouveau.
- Pour un compte Team ou Enterprise, renseignez `CHATGPT_ACCOUNT_ID`.
- Redémarrez le client MCP après chaque changement.

**`UNSUPPORTED_URL`** : utilisez l'un des formats listés dans [URLs prises en charge](#urls-prises-en-charge).

**Échec sur une URL de projet** (`AUTH_FAILED` ou `CONVERSATION_NOT_FOUND_OR_FORBIDDEN`) : gardez l'URL `/g/...` d'origine (ne la transformez pas en `/c/...`), vérifiez `owner_user_id` pour une conversation partagée, et renouvelez le token.

**Erreur réseau avec `cache_available: true`** : une version en cache existe. Utilisez `get_chatgpt_context` si une version potentiellement ancienne vous suffit.

## Structure du projet

```text
src/
  main.ts                  Point d'entrée : charge le fichier env et démarre le serveur en stdio
  config/                  Lecture du fichier d'environnement
  mcp/                     Serveur MCP, instructions et outils
  providers/chatgpt/       Analyse des URLs, authentification, client HTTP, partages
  rendering/               Extraction des messages, rendu Markdown, troncature
  storage/                 Cache sur disque, index, hash du contenu
  shared/                  Erreurs et utilitaires communs
tests/                     Tests Vitest (fetch simulé, aucun vrai token nécessaire)
```

## Développement

```bash
npm install
npm run dev      # lance le serveur depuis les sources
npm test
npm run check    # tests, vérification des types et build
```

## Origine et licence

Ce projet est dérivé de [chatgpt-context-mcp](https://github.com/protosskai/chatgpt-context-mcp), puis largement réécrit : prise en charge des projets ChatGPT, suivi de la branche affichée, troncature cohérente, support de Windows et nouvelle structure.

Distribué sous licence MIT. Voir [LICENSE](./LICENSE).
