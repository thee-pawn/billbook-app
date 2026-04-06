# GitHub Authentication Guide

This application needs to clone your backend and frontend repositories. Depending on whether they're public or private, you may need authentication.

## Authentication Methods

### 1. Personal Access Token (Recommended) ⭐

Best for most use cases. Simple and secure.

#### Step-by-Step:

1. **Create Token**
   - Go to: https://github.com/settings/tokens
   - Click: "Generate new token (classic)"
   - Name it: "BillBook Electron App"
   
2. **Select Scopes**
   - ✅ `repo` (Full control of private repositories)
   - This gives read/write access to your repositories
   
3. **Generate & Copy**
   - Click "Generate token"
   - Copy the token immediately (you can't see it again!)
   - It looks like: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

4. **Use in App**
   
   **Option A: Config File (Recommended)**
   ```json
   // config.local.json
   {
     "githubToken": "ghp_your_actual_token_here"
   }
   ```
   
   **Option B: Environment Variable**
   ```bash
   export GITHUB_TOKEN=ghp_your_actual_token_here
   ```

#### Security Notes:
- ✅ Token is stored locally on user's machine
- ✅ Not committed to git (in `.gitignore`)
- ✅ Can be revoked anytime from GitHub
- ⚠️ Keep it secret! Don't share or commit it

---

### 2. SSH Keys (Advanced)

Better security but more complex setup. Good for developers.

#### Requirements:
- SSH key pair generated
- Public key added to GitHub account
- SSH agent running

#### Step-by-Step:

1. **Generate SSH Key** (if you don't have one)
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # Press Enter to accept default location
   # Enter a passphrase (optional)
   ```

2. **Add to SSH Agent**
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```

3. **Add Public Key to GitHub**
   - Copy your public key:
     ```bash
     cat ~/.ssh/id_ed25519.pub
     ```
   - Go to: https://github.com/settings/keys
   - Click "New SSH key"
   - Paste the key

4. **Use SSH URLs**
   ```json
   // config.local.json
   {
     "backendRepoUrl": "git@github.com:your-org/backend.git",
     "frontendRepoUrl": "git@github.com:your-org/frontend.git"
   }
   ```

#### Pros:
- ✅ More secure (private key never leaves your machine)
- ✅ No token to manage
- ✅ Works with 2FA automatically

#### Cons:
- ❌ More complex setup
- ❌ Requires SSH keys on each user's machine
- ❌ May not work in some corporate networks

---

### 3. GitHub App (Enterprise)

OAuth-based authentication. Best for organizations.

#### When to Use:
- Multiple users
- Need fine-grained permissions
- Want OAuth flow
- Enterprise environment

#### Setup:
1. Create GitHub App on your organization
2. Implement OAuth flow in Electron
3. Store access tokens securely
4. Refresh tokens when expired

This requires significant development. Only recommended for enterprise deployments.

---

## For Public Repositories

If your repositories are **public**, you don't need any authentication!

Just use the HTTPS URL without a token:

```json
{
  "backendRepoUrl": "https://github.com/your-org/backend.git",
  "frontendRepoUrl": "https://github.com/your-org/frontend.git"
}
```

The app will clone and pull without credentials.

---

## Comparison Table

| Method | Security | Setup | User Experience | Best For |
|--------|----------|-------|-----------------|----------|
| **Personal Access Token** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Most users |
| **SSH Keys** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | Developers |
| **GitHub App** | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | Enterprise |
| **No Auth (Public)** | N/A | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Public repos |

---

## Implementation in This App

This application is configured to use **Personal Access Tokens** because:

1. ✅ Simple to set up
2. ✅ Works across all platforms
3. ✅ No complex SSH configuration
4. ✅ Can be revoked easily
5. ✅ Works with 2FA enabled accounts

The token is injected into the HTTPS URL:
```
https://TOKEN@github.com/org/repo.git
```

---

## Token Security Best Practices

### DO:
- ✅ Use config files not committed to git
- ✅ Use environment variables
- ✅ Generate tokens with minimum required scopes
- ✅ Set expiration dates on tokens
- ✅ Revoke tokens when no longer needed
- ✅ Use different tokens for different apps

### DON'T:
- ❌ Hardcode tokens in source code
- ❌ Commit tokens to git
- ❌ Share tokens with others
- ❌ Use your password instead of a token
- ❌ Give tokens more permissions than needed

---

## Revoking a Token

If your token is compromised:

1. Go to: https://github.com/settings/tokens
2. Find your token
3. Click "Delete"
4. Generate a new one
5. Update your `config.local.json`

The old token will immediately stop working.

---

## Troubleshooting

### "Authentication failed"
- ✅ Check token is correct (no extra spaces)
- ✅ Verify token has `repo` scope
- ✅ Check if token is expired
- ✅ Make sure repo URL is correct

### "Repository not found"
- ✅ Verify the repo exists
- ✅ Check you have access to the repo
- ✅ Ensure token has correct permissions
- ✅ Try accessing repo in browser while logged in

### "fatal: could not read Username"
- ✅ Make sure using HTTPS URL, not SSH
- ✅ Add token to URL or config
- ✅ Check token is in correct format

---

## For Distribution

When distributing your app to end users:

1. **Include in Documentation**
   - How to create GitHub token
   - Where to put it (config.local.json)
   - What permissions are needed

2. **First-Run Setup**
   - Could add a setup wizard to collect token
   - Store it securely in app's user data directory
   - Validate token before proceeding

3. **Alternative: Bundle Repositories**
   - Pre-clone repos and bundle with app
   - Use `electron-builder` to include them
   - No authentication needed
   - But updates won't work

---

## Questions?

- **Q: Can users see my token?**
  - A: No, it's stored locally on their machine
  
- **Q: What if my repo is private?**
  - A: Users need their own token with access to that repo
  
- **Q: Can I use the same token for multiple users?**
  - A: Not recommended. Each user should have their own token
  
- **Q: Does this work with GitHub Enterprise?**
  - A: Yes! Just change the URL format in the config
  
- **Q: What about GitLab/Bitbucket?**
  - A: Similar approach works, but URLs and token formats differ
