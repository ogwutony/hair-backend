# API Specification: Profile System, Social SSO, & Media Uploads

**Version**: 1.0  
**Last Updated**: March 20, 2026  
**Status**: In Development

---

## Table of Contents
1. [Overview](#overview)
2. [Authentication (Social SSO)](#authentication-social-sso)
3. [Profile Endpoints](#profile-endpoints)
4. [Messaging Endpoints](#messaging-endpoints)
5. [Public User Profile Endpoint](#public-user-profile-endpoint)
6. [Media Upload Endpoints](#media-upload-endpoints)
7. [Data Models](#data-models)
8. [Error Handling](#error-handling)

---

## Overview

This API supports:
- **Social Single Sign-On (SSO)**: Google, Instagram, TikTok login
- **User Profile System**: 4-box interactive layout (Introduce, Profession, Beauty Philosophy, Open Ideas)
- **Media Support**: Text, photos, videos with social media links
- **Rank System**: Points-based progression with next-rank calculation

**Base URL**: `https://hair-backend-1.onrender.com`

---

## Authentication (Social SSO)

### 1. Google OAuth Sign-In
**Endpoint**: `POST /api/auth/google`

**Description**: Sign in or create account using Google credentials.

**Request**:
```json
{
  "accessToken": "string (JWT from Google)"
}
```

**Response** (200):
```json
{
  "email": "user@gmail.com",
  "token": "internal-jwt-token",
  "rank_title": "bolshevik",
  "rank_score": 1,
  "socialLinks": {
    "google": "user@gmail.com"
  }
}
```

**Error** (400/401):
```json
{
  "error": "Invalid token" | "User creation failed"
}
```

---

### 2. Instagram OAuth Sign-In
**Endpoint**: `POST /api/auth/instagram`

**Description**: Sign in or create account using Instagram credentials.

**Request**:
```json
{
  "accessToken": "string (Instagram Graph API token)",
  "instagramUserId": "string (Instagram User ID)"
}
```

**Response** (200):
```json
{
  "email": "user@instagram.com",
  "token": "internal-jwt-token",
  "rank_title": "bolshevik",
  "rank_score": 1,
  "socialLinks": {
    "instagram": "username"
  }
}
```

**Error** (400/401):
```json
{
  "error": "Invalid Instagram token" | "User creation failed"
}
```

---

### 3. TikTok OAuth Sign-In
**Endpoint**: `POST /api/auth/tiktok`

**Description**: Sign in or create account using TikTok credentials.

**Request**:
```json
{
  "accessToken": "string (TikTok OAuth token)",
  "tiktokUserId": "string (TikTok User ID)"
}
```

**Response** (200):
```json
{
  "email": "user@tiktok.com",
  "token": "internal-jwt-token",
  "rank_title": "bolshevik",
  "rank_score": 1,
  "socialLinks": {
    "tiktok": "username"
  }
}
```

**Error** (400/401):
```json
{
  "error": "Invalid TikTok token" | "User creation failed"
}
```

---

## Profile Endpoints

### 1. Get User Profile
**Endpoint**: `GET /api/profile`
**Status**: ✅ Implemented (includes `displayName` and `location`)

**Headers**:
```
Authorization: Bearer {token}
```

**Response** (200):
```json
{
  "_id": "user-mongo-id",
  "email": "user@example.com",
  "rank_title": "bolshevik",
  "rank_score": 250,
  "nextRankTitle": "crucian carp",
  "nextRankThreshold": 250,
  "pointsToNextRank": 0,
  "perspective": {
    "box1": {
      "label": "Introduce yourself",
      "content": "Hi, I'm...",
      "mediaUrls": ["url1", "url2"],
      "videoUrl": "https://..."
    },
    "box2": {
      "label": "Tell us what you do",
      "content": "I work in...",
      "mediaUrls": [],
      "videoUrl": null
    },
    "box3": {
      "label": "What are your thoughts on what makes someone beautiful?",
      "content": "Beauty is...",
      "mediaUrls": [],
      "videoUrl": null
    },
    "box4": {
      "label": "Ideas about anything else",
      "content": "I think...",
      "mediaUrls": [],
      "videoUrl": null
    }
  },
  "socialLinks": {
    "google": "user@gmail.com",
    "instagram": "instagram_username",
    "tiktok": "tiktok_username",
    "facebook": "facebook_username"
  },
  "displayName": "Jane Doe",
  "location": "Los Angeles, CA",
  "createdAt": "2026-03-20T10:00:00Z",
  "updatedAt": "2026-03-20T15:30:00Z"
}
```

**Error** (401/404):
```json
{
  "error": "Unauthorized" | "User not found"
}
```

---

### 2. Update User Profile
**Endpoint**: `PUT /api/profile`
**Status**: ✅ Implemented (accepts and persists `displayName` and `location`)

**Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request**:
```json
{
  "perspective": {
    "box1": {
      "content": "Updated introduction text",
      "mediaUrls": ["photo-url-1", "photo-url-2"],
      "videoUrl": "video-url-from-storage"
    },
    "box2": {
      "content": "What I do...",
      "mediaUrls": [],
      "videoUrl": null
    },
    "box3": {
      "content": "Beauty philosophy...",
      "mediaUrls": [],
      "videoUrl": null
    },
    "box4": {
      "content": "Other ideas...",
      "mediaUrls": [],
      "videoUrl": null
    }
  },
  "displayName": "Jane Doe",
  "location": "Los Angeles, CA"
}
```

**Response** (200):
```json
{
  "message": "Profile updated successfully",
  "profile": {
    "_id": "user-id",
    "email": "user@example.com",
    "perspective": { /* updated perspective */ }
  }
}
```

**Error** (400/401):
```json
{
  "error": "Invalid input" | "Unauthorized"
}
```

---

### 3. Update Social Media Links
**Endpoint**: `PUT /api/profile/social-links`

**Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request**:
```json
{
  "socialLinks": {
    "instagram": "new_instagram_handle",
    "tiktok": "new_tiktok_handle",
    "facebook": "new_facebook_handle"
  }
}
```

**Response** (200):
```json
{
  "message": "Social links updated",
  "socialLinks": {
    "google": "user@gmail.com",
    "instagram": "new_instagram_handle",
    "tiktok": "new_tiktok_handle",
    "facebook": "new_facebook_handle"
  }
}
```

**Error** (400/401):
```json
{
  "error": "Invalid social handle" | "Unauthorized"
}
```

---

## Messaging Endpoints

### 1. Get Inbox
**Status**: ✅ Implemented
**Endpoint**: `GET /api/messages/inbox`

**Headers**:
```
Authorization: Bearer {token}
```

**Response** (200):
```json
[
  {
    "id": "conversation-id",
    "otherUserId": "other-user-id",
    "otherUserName": "Jane Doe",
    "otherUserAvatar": "https://...",
    "lastMessage": "Hey, loved your last post!",
    "lastMessageAt": "2026-03-20T15:30:00Z",
    "unreadCount": 2
  }
]
```

**Error** (401):
```json
{
  "error": "Unauthorized"
}
```

---

## Public User Profile Endpoint

### 1. Get Public Profile
**Status**: ✅ Implemented
**Endpoint**: `GET /api/users/:id`

**Response** (200):
```json
{
  "id": "user-id",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "avatarUrl": "https://...",
  "rank": "bolshevik",
  "followers": [],
  "following": [],
  "perspective": {
    "box1": { "content": "...", "mediaUrls": [], "videoUrl": null },
    "box2": { "content": "...", "mediaUrls": [], "videoUrl": null },
    "box3": { "content": "...", "mediaUrls": [], "videoUrl": null },
    "box4": { "content": "...", "mediaUrls": [], "videoUrl": null }
  }
}
```

**Error** (404):
```json
{
  "error": "User not found"
}
```

---

## Media Upload Endpoints

### 1. Upload Photo/Video
**Endpoint**: `POST /api/media/upload`

**Headers**:
```
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Form Data**:
- `file`: Binary file (image or video)
- `box`: "box1" | "box2" | "box3" | "box4" (which profile box)
- `mediaType`: "photo" | "video"

**File Constraints**:
- **Photos**: Max 5MB, formats: JPG, PNG, WEBP
- **Videos**: Max 50MB, formats: MP4, WebM
- **Duration**: Max 60 seconds for videos

**Response** (200):
```json
{
  "message": "File uploaded successfully",
  "mediaUrl": "https://storage.example.com/user-id/box1/photo-1234567.jpg",
  "mediaType": "photo",
  "box": "box1",
  "uploadedAt": "2026-03-20T10:30:00Z"
}
```

**Error** (400/413):
```json
{
  "error": "File too large" | "Invalid file format" | "Unauthorized"
}
```

---

### 2. Delete Media
**Endpoint**: `DELETE /api/media/{mediaId}`

**Headers**:
```
Authorization: Bearer {token}
```

**Response** (200):
```json
{
  "message": "Media deleted successfully"
}
```

**Error** (401/404):
```json
{
  "error": "Unauthorized" | "Media not found"
}
```

---

### 3. Get Signed Upload URL (Alternative: Direct Upload)
**Endpoint**: `POST /api/media/get-upload-url`

**Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request**:
```json
{
  "fileName": "photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 2048000
}
```

**Response** (200):
```json
{
  "uploadUrl": "https://storage.example.com/upload?token=...",
  "mediaUrl": "https://storage.example.com/files/user-id/photo-1234.jpg",
  "expiresIn": 3600
}
```

---

## Data Models

### User Schema
```javascript
{
  _id: ObjectId,
  email: String (unique),
  passwordHash: String (nullable if SSO),
  rank_title: String,
  rank_score: Number (default: 1),
  displayName: String (default: ""),
  location: String (default: ""),
  
  // Profile perspective boxes
  perspective: {
    box1: {
      content: String,
      mediaUrls: [String],  // Photo URLs
      videoUrl: String,      // Single video per box
      updatedAt: Date
    },
    box2: { ... },
    box3: { ... },
    box4: { ... }
  },
  
  // Social media connections
  socialLinks: {
    google: String (email),
    instagram: String (username),
    tiktok: String (username),
    facebook: String (username)
  },
  
  // OAuth provider mappings
  oauthProviders: {
    google: {
      googleId: String,
      email: String
    },
    instagram: {
      instagramId: String,
      username: String
    },
    tiktok: {
      tiktokId: String,
      username: String
    }
  },
  
  createdAt: Date,
  updatedAt: Date
}
```

### Conversation Schema
```javascript
{
  _id: ObjectId,
  participants: [ObjectId],  // exactly 2 User refs
  lastMessage: String,
  lastMessageAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Message Schema
```javascript
{
  _id: ObjectId,
  conversationId: ObjectId,
  senderId: ObjectId,
  text: String,
  readBy: [ObjectId],  // User refs who have read this message
  createdAt: Date
}
```

### Media Item Schema
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  box: String,  // "box1", "box2", "box3", "box4"
  mediaType: String,  // "photo" | "video"
  mediaUrl: String,
  fileSize: Number,
  uploadedAt: Date
}
```

### Rank Progression
```javascript
// Calculate points to next rank
const getPointsToNextRank = (currentScore, currentRank) => {
  const RANK_TIERS = [
    { title: "General Secretary", min: 8500001 },
    { title: "Premier", min: 7000001 },
    // ... all ranks
    { title: "bolshevik", min: 1 }
  ];
  
  // Find next rank from current position
  const currentIndex = RANK_TIERS.findIndex(r => r.title === currentRank);
  if (currentIndex === 0) return 0;  // Already at top
  
  const nextRank = RANK_TIERS[currentIndex - 1];
  const pointsNeeded = nextRank.min - currentScore;
  
  return Math.max(0, pointsNeeded);
};
```

---

## Error Handling

### Standard Error Response
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { /* optional additional info */ }
}
```

### HTTP Status Codes
- **200**: Success
- **201**: Created
- **400**: Bad Request (invalid input)
- **401**: Unauthorized (missing/invalid token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **413**: Payload Too Large (file exceeds limits)
- **500**: Server Error

### Common Error Codes
| Code | Message | Status |
|------|---------|--------|
| `INVALID_TOKEN` | Token is invalid or expired | 401 |
| `MISSING_TOKEN` | Authorization header missing | 401 |
| `USER_NOT_FOUND` | User does not exist | 404 |
| `INVALID_FILE_FORMAT` | File type not supported | 400 |
| `FILE_TOO_LARGE` | File exceeds size limit | 413 |
| `OAUTH_FAILED` | OAuth provider authentication failed | 401 |
| `SOCIAL_UPDATE_FAILED` | Could not update social links | 400 |

---

## Frontend Integration Notes

### Environment Variables Required
```env
REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id
REACT_APP_INSTAGRAM_APP_ID=your-instagram-app-id
REACT_APP_TIKTOK_CLIENT_KEY=your-tiktok-client-key
REACT_APP_BACKEND_URL=https://hair-backend-1.onrender.com
```

### Next Rank Calculation (Frontend)
```javascript
const calculateNextRank = (rankScore, RANK_TIERS) => {
  for (const tier of RANK_TIERS) {
    if (rankScore >= tier.min) {
      const currentIndex = RANK_TIERS.findIndex(r => r.title === tier.title);
      if (currentIndex === 0) {
        return { nextRank: null, pointsNeeded: 0 };
      }
      const nextRank = RANK_TIERS[currentIndex - 1];
      return {
        nextRank: nextRank.title,
        pointsNeeded: nextRank.min - rankScore
      };
    }
  }
};
```

---

## Deployment Checklist

**Backend**:
- [ ] Implement OAuth flows for Google, Instagram, TikTok
- [ ] Set up user profile schema
- [ ] Create media upload storage (AWS S3, Cloudinary, or similar)
- [ ] Implement media upload endpoints with file validation
- [ ] Add rank calculation endpoint
- [ ] Test all endpoints with Postman/Insomnia
- [ ] Set CORS headers for frontend domain

**Frontend**:
- [ ] Integrate Google, Instagram, TikTok SDKs
- [ ] Create ProfilePage with 4-box layout
- [ ] Implement media upload UI
- [ ] Add rank progression display
- [ ] Add social links form
- [ ] Test end-to-end flow

---

## Future Enhancements

- [ ] Profile visibility settings (public/private)
- [ ] Comments/interactions on profile boxes
- [ ] Profile analytics (view count, engagement)
- [ ] Batch media upload
- [ ] Image cropping/editing before upload
- [ ] Video transcoding for optimization

