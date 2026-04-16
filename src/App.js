import React, { useState, useEffect, useCallback } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

// --- 1. STRIPE INITIALIZATION ---
const stripePromise = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY).catch(err => {
      console.warn("Stripe failed to load:", err);
      return null;
    })
  : Promise.resolve(null);

// --- 2. BACKEND CONFIGURATION ---
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://hair-backend-2.onrender.com";

// --- 3. RANK SYSTEM (50-Tier Hierarchy) ---
const RANK_TIERS = [
  // --- EXECUTIVE COMMAND (20M - 50M+) ---
  { title: "General Secretary",                         min: 50000000 },
  { title: "Politburo Member",                          min: 45000000 },
  { title: "Politburo Candidate Member",                min: 40000000 },
  { title: "Secretary of the Central Committee",        min: 36000000 },
  { title: "Member of the Central Committee",           min: 32000000 },
  { title: "Candidate Member of the Central Committee", min: 29000000 },
  { title: "Head of a Central Committee Department",    min: 26000000 },
  { title: "First Secretary of a Republic",             min: 24000000 },
  { title: "First Secretary of the Obkom",              min: 22000000 },
  { title: "First Secretary of the Raikom",             min: 20000000 },

  // --- HEROIC ORDERS & LABOR TITLES (2M - 18.5M) ---
  { title: "Hero of Socialist Labor",                   min: 18500000 },
  { title: "Hero of the Majorities",                    min: 17000000 },
  { title: "Order of The Majorities",                   min: 15500000 },
  { title: "Order of the October Revolution",           min: 14000000 },
  { title: "Order of the Red Banner of Labor",          min: 12500000 },
  { title: "Order of Friendship of Peoples",            min: 11000000 },
  { title: "Order of the Badge of Honor",               min: 9500000  },
  { title: "Order of Maternal Glory",                   min: 8000000  },
  { title: "Order of Labor Glory",                      min: 6500000  },
  { title: "Labour Valour",                             min: 5500000  },
  { title: "Distinguished Labour",                      min: 4500000  },
  { title: "Veteran of Labour",                         min: 3500000  },
  { title: "the Salvation of the Drowning",             min: 2000000  },

  // --- MYTHOLOGICAL & DEDOVSHCHINA HIERARCHY ---
  { title: "Knight Bear",       min: 1800000 },
  { title: "Magistral",         min: 1600000 },
  { title: "Demobbed",          min: 1400000 },
  { title: "Dedovshchina",      min: 1200000 },
  { title: "Gold Bear",         min: 1000000 },
  { title: "Green Elephant",    min: 800000  },
  { title: "Perun",             min: 600000  },
  { title: "Svarozhits",        min: 400000  },
  { title: "Veles",             min: 200000  },
  { title: "Dazhbog",           min: 100000  },
  { title: "Sliver Bear",       min: 50000   },
  { title: "Scoop",             min: 25000   },
  { title: "Dola",              min: 10000   },
  { title: "Mammoth",           min: 5000    },
  { title: "Goldfinches",       min: 2500    },
  { title: "Walruses",          min: 1000    },
  { title: "Rugiaevit",         min: 500     },
  { title: "Crucian Carp",      min: 250     },
  { title: "Crows",             min: 100     },
  { title: "Comrade",           min: 1       },
];

const getRankTitle = (score) => {
  for (const tier of RANK_TIERS) {
    if (score >= tier.min) return tier.title;
  }
  return "Comrade";
};

const isPolitburoOrHigher = (score) => score >= 45000000;

// --- CALCULATE POINTS TO NEXT RANK ---
const getPointsToNextRank = (currentScore, currentRankTitle) => {
  const currentIndex = RANK_TIERS.findIndex(r => r.title === currentRankTitle);
  if (currentIndex <= 0) return 0;
  const nextRank = RANK_TIERS[currentIndex - 1];
  return Math.max(0, nextRank.min - currentScore);
};

const getNextRankTitle = (currentRankTitle) => {
  const currentIndex = RANK_TIERS.findIndex(r => r.title === currentRankTitle);
  if (currentIndex <= 0) return null;
  return RANK_TIERS[currentIndex - 1].title;
};

const getRankColor = (rankTitle) => {
  const goldTier = [
    "General Secretary", "Politburo Member", "Politburo Candidate Member",
    "Secretary of the Central Committee", "Member of the Central Committee",
    "Candidate Member of the Central Committee", "Head of a Central Committee Department",
    "First Secretary of a Republic", "First Secretary of the Obkom", "First Secretary of the Raikom",
    "Hero of Socialist Labor", "Hero of the Majorities", "Order of The Majorities",
    "Order of the October Revolution", "Order of the Red Banner of Labor",
    "Order of Friendship of Peoples", "Order of the Badge of Honor", "Order of Maternal Glory",
    "Order of Labor Glory", "Labour Valour", "Distinguished Labour", "Veteran of Labour",
    "the Salvation of the Drowning", "Knight Bear", "Magistral", "Demobbed", "Dedovshchina", "Gold Bear"
  ];
  const silverTier = ["Green Elephant", "Perun", "Svarozhits", "Veles", "Dazhbog", "Sliver Bear", "Scoop"];
  if (goldTier.includes(rankTitle)) return '#FFD700';
  if (silverTier.includes(rankTitle)) return '#C0C0C0';
  return '#888';
};

// --- RANK BADGE COMPONENT ---
const RankBadge = ({ rankTitle, score }) => {
  const color = getRankColor(rankTitle);
  const isGenSec = rankTitle === "General Secretary";
  const isLongTitle = rankTitle && rankTitle.length > 20;
  return (
    <span style={{
      fontSize: isLongTitle ? '9px' : '11px',
      fontWeight: '700',
      color: color,
      padding: '2px 8px',
      borderRadius: '12px',
      border: `1px solid ${color}`,
      textTransform: 'uppercase',
      letterSpacing: isLongTitle ? '0px' : '0.5px',
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      display: 'inline-block',
      maxWidth: '200px',
      lineHeight: '1.3',
      ...(isGenSec ? styles.generalSecretaryBadge : {})
    }}>
      {rankTitle}
    </span>
  );
};

// --- CREDENTIAL HEADER COMPONENT ---
const safeSocialUrl = (raw) => {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
};

const CredentialHeader = ({ email, rankTitle, rankScore, avatarUrl, socialLinks = {} }) => {
  const initial = (rankTitle || 'C')[0].toUpperCase();
  const color = getRankColor(rankTitle || 'Comrade');
  const isGenSec = rankTitle === "General Secretary";
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
      <div style={{
        width: '50px',
        height: '50px',
        borderRadius: '50%',
        backgroundColor: avatarUrl ? 'transparent' : color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
        fontWeight: '700',
        color: '#fff',
        flexShrink: 0,
        overflow: 'hidden',
        ...(isGenSec && !avatarUrl ? { boxShadow: '0 0 12px rgba(255,215,0,0.8)' } : {})
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initial}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
          <RankBadge rankTitle={rankTitle || 'Comrade'} />
          {rankScore != null && (
            <span style={{ fontSize: '11px', color: '#aaa' }}>
              {(rankScore || 1).toLocaleString()} pts
            </span>
          )}
        </div>
        {socialLinks && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            {socialLinks.instagram ? (
              <a
                href={safeSocialUrl(socialLinks.instagram)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', fontSize: '15px' }}
                title="Instagram"
              >{"\u{1F4F7}"}</a>
            ) : null}
            {socialLinks.tiktok ? (
              <a
                href={safeSocialUrl(socialLinks.tiktok)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', fontSize: '15px' }}
                title="TikTok"
              >{"\u{1F3B5}"}</a>
            ) : null}
            {socialLinks.facebook ? (
              <a
                href={safeSocialUrl(socialLinks.facebook)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', fontSize: '11px', color: '#1877F2', fontWeight: '600' }}
                title="Facebook"
              >Facebook</a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

// --- 3. UI HELPERS ---
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};

// --- 5. STRIPE UI CONFIGURATION ---
const appearance = { theme: 'flat', variables: { colorPrimaryText: '#262626' } };
const paymentElementOptions = {
  layout: { type: 'accordion', defaultCollapsed: false, radios: 'always', spacedAccordionItems: false },
  business: { name: "Majority Hair Solutions" }
};

const productsData = {
  shampoos: [
    { name: "Hydrating Shampoo", desc: "Deep moisture for daily cleansing." },
    { name: "Repair Shampoo", desc: "Strengthens damaged hair." },
    { name: "Clarify Shampoo", desc: "Removes buildup and residue." },
    { name: "Balance Shampoo", desc: "Restores scalp balance." }
  ],
  conditioners: [
    { name: "Smooth Conditioner", desc: "Softens and detangles." },
    { name: "Moisture Conditioner", desc: "Long-lasting hydration." },
    { name: "Strength Conditioner", desc: "Reinforces hair fibers." },
    { name: "Shine Conditioner", desc: "Adds natural gloss." }
  ],
  oils: [
    { name: "Growth Oil", desc: "Supports healthy growth." },
    { name: "Scalp Oil", desc: "Soothes dry scalp." },
    { name: "Light Oil", desc: "Weightless daily oil." },
    { name: "Nourish Oil", desc: "Deep nourishment." }
  ],
  faceScrubs: [
    { name: "Exfoliating Scrub", desc: "Removes dead skin cells." },
    { name: "Gentle Scrub", desc: "Mild daily exfoliation." },
    { name: "Brightening Scrub", desc: "Evens skin tone." },
    { name: "Deep Clean Scrub", desc: "Unclogs pores deeply." }
  ],
  toners: [
    { name: "Hydrating Toner", desc: "Replenishes moisture after cleansing." },
    { name: "Clarifying Toner", desc: "Minimises pores and removes residue." },
    { name: "Soothing Toner", desc: "Calms redness and irritation." },
    { name: "Brightening Toner", desc: "Boosts radiance and even tone." }
  ],
  faceCreams: [
    { name: "Moisturising Cream", desc: "All-day hydration barrier." },
    { name: "Night Cream", desc: "Repairs skin while you sleep." },
    { name: "SPF Day Cream", desc: "Protects against UV damage." },
    { name: "Anti-Ageing Cream", desc: "Reduces fine lines and wrinkles." }
  ]
};

// --- PROFILE PAGE COMPONENT - Enhanced with Photo & Video Features ---
const ProfilePage = ({ userEmail, savedSets, rankTitle, rankScore, authToken, onAddPoints, onAvatarUpdate, userAvatar }) => {
  const [avatarUrl, setAvatarUrl] = useState(userAvatar || null);
  const [avatarSaveStatus, setAvatarSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [hadExistingAvatar, setHadExistingAvatar] = useState(false);
  const avatarInputRef = React.useRef(null);
  const [perspective, setPerspective] = useState({
    box1: { videoUrl: null, description: "", videoFile: null },
    box2: { videoUrl: null, description: "", videoFile: null },
    box3: { videoUrl: null, description: "", videoFile: null },
    box4: { videoUrl: null, description: "", videoFile: null }
  });
  const [videoSaveStatus, setVideoSaveStatus] = useState({}); // { box1: "idle"|"saving"|"saved"|"error" }
  const [socialLinks, setSocialLinks] = useState({
    instagram: "",
    tiktok: "",
    facebook: ""
  });
  const [editingBox, setEditingBox] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [dumaSubmitStatus, setDumaSubmitStatus] = useState({});
  const [socialSaveStatus, setSocialSaveStatus] = useState({ instagram: "idle", tiktok: "idle", facebook: "idle" });
  const [anyVideoPushed, setAnyVideoPushed] = useState(false);

  const blobAvatarUrlRef = React.useRef(null);

  useEffect(() => {
    return () => {
      if (blobAvatarUrlRef.current) {
        URL.revokeObjectURL(blobAvatarUrlRef.current);
        blobAvatarUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${BACKEND_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${authToken}` }
    }).then(r => { if (!r.ok) throw new Error('Failed to fetch profile'); return r.json(); }).then(data => {
      if (data.avatar) {
        setAvatarUrl(data.avatar);
        setHadExistingAvatar(true);
        if (onAvatarUpdate) onAvatarUpdate(data.avatar);
      }
      if (data.socialLinks) setSocialLinks(prev => ({ ...prev, ...data.socialLinks }));
      if (data.perspective) {
        setPerspective(prev => {
          const updated = { ...prev };
          for (const key in data.perspective) {
            if (updated[key]) updated[key] = { ...updated[key], ...data.perspective[key] };
          }
          return updated;
        });
      }
    }).catch(() => {});
  }, [authToken, onAvatarUpdate]);

  const handleSocialChange = (key, value) => {
    setSocialLinks(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveSocialLink = async (key) => {
    if (!authToken) return;
    setSocialSaveStatus(prev => ({ ...prev, [key]: "saving" }));
    try {
      const response = await fetch(`${BACKEND_URL}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ socialLinks: { [key]: socialLinks[key] } })
      });
      if (response.ok) {
        setSocialSaveStatus(prev => ({ ...prev, [key]: "saved" }));
        setTimeout(() => setSocialSaveStatus(prev => ({ ...prev, [key]: "idle" })), 3000);
      } else {
        setSocialSaveStatus(prev => ({ ...prev, [key]: "error" }));
        setTimeout(() => setSocialSaveStatus(prev => ({ ...prev, [key]: "idle" })), 3000);
      }
    } catch {
      setSocialSaveStatus(prev => ({ ...prev, [key]: "error" }));
      setTimeout(() => setSocialSaveStatus(prev => ({ ...prev, [key]: "idle" })), 3000);
    }
  };

  const handleAvatarUpload = async (e) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    // Reset input so the same file can be re-selected if needed
    e.target.value = "";
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('Please upload a JPG or PNG image only.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be smaller than 5MB.');
      return;
    }
    // Show local preview immediately
    const previewUrl = URL.createObjectURL(file);
    blobAvatarUrlRef.current = previewUrl;
    setAvatarUrl(previewUrl);
    setAvatarSaveStatus("saving"); // triggers "Uploading…" overlay

    if (!authToken) {
      // Not logged in — keep local preview only
      setAvatarSaveStatus("idle");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${BACKEND_URL}/api/media/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData
      });
      if (response.ok) {
        const data = await response.json();
        const cloudUrl = data.url || data.secure_url;
        setAvatarUrl(cloudUrl);
        if (onAvatarUpdate) onAvatarUpdate(cloudUrl);
        // Persist the new avatar URL to the user's profile record
        const profileRes = await fetch(`${BACKEND_URL}/api/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ avatar: cloudUrl })
        });
        if (!profileRes.ok) {
          setAvatarSaveStatus("error");
          setTimeout(() => setAvatarSaveStatus("idle"), 3000);
          return;
        }
        setAvatarSaveStatus("saved");
        if (!hadExistingAvatar && onAddPoints) {
          onAddPoints(25);
          setHadExistingAvatar(true);
        }
        setTimeout(() => setAvatarSaveStatus("idle"), 3000);
      } else {
        setAvatarSaveStatus("error");
        setTimeout(() => setAvatarSaveStatus("idle"), 3000);
      }
    } catch (err) {
      setAvatarSaveStatus("error");
      setTimeout(() => setAvatarSaveStatus("idle"), 3000);
    }
  };

  const handleVideoUpload = (boxKey, e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!['video/mp4', 'video/quicktime'].includes(file.type)) {
        alert('Please upload an MP4 or MOV video.');
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        alert('Video must be smaller than 100MB.');
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        if (videoEl.duration > 60) {
          URL.revokeObjectURL(objectUrl);
          alert('Video must be 60 seconds or less.');
          return;
        }
        setPerspective(prev => {
          if (prev[boxKey].videoUrl && prev[boxKey].videoUrl.startsWith('blob:')) {
            URL.revokeObjectURL(prev[boxKey].videoUrl);
          }
          return { ...prev, [boxKey]: { ...prev[boxKey], videoUrl: objectUrl, videoFile: file } };
        });
        setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "idle" }));
      };
      videoEl.src = objectUrl;
    }
  };

  const handleSaveVideo = async (boxKey) => {
    if (!perspective[boxKey].videoFile || !authToken) return;
    setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "saving" }));
    try {
      const formData = new FormData();
      formData.append("file", perspective[boxKey].videoFile);
      formData.append("type", "video");
      formData.append("boxKey", boxKey);
      const uploadRes = await fetch(`${BACKEND_URL}/api/media/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData
      });
      const uploadData = uploadRes.ok ? await uploadRes.json() : null;
      const savedVideoUrl = uploadData?.url || perspective[boxKey].videoUrl;
      const updatedPerspective = {
        ...perspective,
        [boxKey]: { ...perspective[boxKey], videoUrl: savedVideoUrl }
      };
      const videoPerspectives = {};
      for (const key in updatedPerspective) {
        if (updatedPerspective[key].videoUrl) {
          videoPerspectives[key] = {
            videoUrl: updatedPerspective[key].videoUrl,
            description: updatedPerspective[key].description
          };
        }
      }
      const profileRes = await fetch(`${BACKEND_URL}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ perspective: videoPerspectives })
      });
      if (profileRes.ok) {
        setPerspective(updatedPerspective);
        if (onAddPoints) onAddPoints(100);
        setAnyVideoPushed(true);
        setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "saved" }));
      } else {
        setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "error" }));
        setTimeout(() => setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "idle" })), 3000);
      }
    } catch {
      setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "error" }));
      setTimeout(() => setVideoSaveStatus(prev => ({ ...prev, [boxKey]: "idle" })), 3000);
    }
  };

  const handleSendToDuma = async (boxKey) => {
    if (!perspective[boxKey].videoUrl) {
      alert('Please upload a video first before sending to the Duma.');
      return;
    }
    setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "Submitting..." }));
    try {
      const response = await fetch(`${BACKEND_URL}/api/duma/culture/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          boxKey,
          videoUrl: perspective[boxKey].videoUrl,
          description: perspective[boxKey].description,
          socialLinks
        })
      });
      if (response.ok) {
        setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "Sent to Duma!" }));
        setAnyVideoPushed(true);
        if (onAddPoints) onAddPoints(100);
        setTimeout(() => setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "" })), 3000);
      } else {
        setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "Submission failed" }));
        setTimeout(() => setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "" })), 3000);
      }
    } catch (err) {
      setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "Error submitting" }));
      setTimeout(() => setDumaSubmitStatus(prev => ({ ...prev, [boxKey]: "" })), 3000);
    }
  };

  const handleDescriptionChange = (boxKey, text) => {
    setPerspective(prev => ({
      ...prev,
      [boxKey]: { ...prev[boxKey], description: text }
    }));
  };

  const boxes = [
    { key: "box1", label: "Introduce yourself", icon: "\u{1F3AC}" },
    { key: "box2", label: "Tell us what you do", icon: "\u{1F3AC}" },
    { key: "box3", label: "What are your thoughts on what makes someone beautiful?", icon: "\u{1F3AC}" },
    { key: "box4", label: "Ideas about anything else", icon: "\u{1F3AC}" }
  ];

  const handleSaveProfile = async () => {
    if (!authToken) return;
    setSaveStatus("Saving...");
    try {
      // Build video perspectives payload
      const videoPerspectives = {};
      for (const boxKey in perspective) {
        if (perspective[boxKey].videoUrl) {
          videoPerspectives[boxKey] = {
            videoUrl: perspective[boxKey].videoUrl,
            description: perspective[boxKey].description
          };
        }
      }
      
      const response = await fetch(`${BACKEND_URL}/api/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ 
          perspective: videoPerspectives, 
          avatar: avatarUrl
        })
      });
      if (response.ok) {
        setSaveStatus("Culture saved successfully!");
        setTimeout(() => setSaveStatus(""), 3000);
      } else {
        setSaveStatus("Failed to save profile");
      }
    } catch (err) {
      setSaveStatus("Server error");
    }
  };

  const pointsToNextRank = getPointsToNextRank(rankScore || 1, rankTitle || 'Comrade');
  const nextRankTitle = getNextRankTitle(rankTitle || 'Comrade');

  const handleSocialShare = (platform, username) => {
    if (!username) {
      alert(`Connect your ${platform} account first in Social Links above.`);
      return;
    }
    const label = platform === 'Facebook' ? platform : `${platform} @${username}`;
    alert(`Your perspective will be shared to ${label}.`);
  };

  return (
    <div style={{ padding: '40px 60px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* HEADER SECTION */}
      <div style={{ marginBottom: '50px' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '8px', fontWeight: '700' }}>Welcome</h1>
        {rankTitle && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <RankBadge rankTitle={rankTitle} />
              <span style={{ fontSize: '13px', color: '#666' }}>{(rankScore || 1).toLocaleString()} points</span>
            </div>
            {nextRankTitle && (
              <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                <strong>{pointsToNextRank.toLocaleString()}</strong> points to your next rank ({nextRankTitle})
              </div>
            )}
          </div>
        )}
      </div>

      {/* AVATAR UPLOAD SECTION */}
      <section style={{ marginBottom: '50px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: '600' }}>Your Profile Avatar</h2>
        <div style={styles.uploadBox}>
          <div style={{ textAlign: 'center' }}>
            {avatarUrl ? (
              <div style={{ marginBottom: '16px', position: 'relative', display: 'inline-block' }}>
                <img
                  src={avatarUrl}
                  alt="Avatar Preview"
                  title="Click to change avatar"
                  role="button"
                  tabIndex={avatarSaveStatus === "saving" ? -1 : 0}
                  onClick={() => avatarSaveStatus !== "saving" && avatarInputRef.current && avatarInputRef.current.click()}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && avatarSaveStatus !== "saving" && avatarInputRef.current && avatarInputRef.current.click()}
                  style={{ width: '150px', height: '150px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px', cursor: avatarSaveStatus === "saving" ? 'default' : 'pointer', opacity: avatarSaveStatus === "saving" ? 0.6 : 1 }}
                />
                {avatarSaveStatus === "saving" && (
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontSize: '13px', fontWeight: '600' }}>Uploading…</span>
                  </div>
                )}
                {avatarSaveStatus !== "saving" && (
                  <p style={{ fontSize: '13px', color: '#666' }}>
                    {avatarSaveStatus === "saved" ? "✓ Uploaded" : avatarSaveStatus === "error" ? "Upload failed — click to retry" : "Click avatar to change"}
                  </p>
                )}
              </div>
            ) : (
              <div
                role="button"
                tabIndex={avatarSaveStatus === "saving" ? -1 : 0}
                style={{ padding: '30px', textAlign: 'center', cursor: avatarSaveStatus === "saving" ? 'default' : 'pointer' }}
                onClick={() => avatarSaveStatus !== "saving" && avatarInputRef.current && avatarInputRef.current.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && avatarSaveStatus !== "saving" && avatarInputRef.current && avatarInputRef.current.click()}>
                <span style={{ fontSize: '48px', marginBottom: '12px', display: 'block' }}>{avatarSaveStatus === "saving" ? "⏳" : "\u{1F464}"}</span>
                <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
                  {avatarSaveStatus === "saving" ? "Uploading…" : "No avatar uploaded yet — click to upload"}
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <label style={{ cursor: 'pointer', display: 'inline-block' }}>
                <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png" onChange={handleAvatarUpload} style={{ display: 'none' }} />
                <button
                  type="button"
                  disabled={avatarSaveStatus === "saving"}
                  style={{ ...styles.authButton, width: '200px', opacity: avatarSaveStatus === "saving" ? 0.6 : 1, cursor: avatarSaveStatus === "saving" ? 'not-allowed' : 'pointer' }}
                  onClick={() => avatarSaveStatus !== "saving" && avatarInputRef.current && avatarInputRef.current.click()}>
                  {avatarSaveStatus === "saving" ? "Uploading…" : "Upload Avatar (JPG/PNG, max 5MB)"}
                </button>
              </label>

            </div>
          </div>
        </div>
      </section>

      {/* PERSPECTIVE BOXES - VIDEO-FIRST (4-BOX LAYOUT) */}
      <section style={{ marginBottom: '50px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: '600' }}>Culture</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '20px' }}>
          {boxes.map(box => (
            <div key={box.key} style={{...styles.perspectiveBox, border: editingBox === box.key ? '2px solid #222' : '1px solid #eee'}}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '24px' }}>{box.icon}</span>
                <button
                  onClick={() => setEditingBox(editingBox === box.key ? null : box.key)}
                  style={{ fontSize: '12px', cursor: 'pointer', background: 'none', border: 'none', color: '#2980b9', fontWeight: '600' }}>
                  {editingBox === box.key ? 'Done' : 'Edit'}
                </button>
              </div>
              <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', color: '#222' }}>{box.label}</h4>
              {editingBox === box.key ? (
                <div style={{ marginBottom: '12px', position: 'relative' }}>
                  {/* PUBLISHING OVERLAY */}
                  {videoSaveStatus[box.key] === "saving" && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#fff', fontSize: '14px', fontWeight: '700' }}>Publishing…</span>
                    </div>
                  )}
                  {/* VIDEO UPLOAD */}
                  {perspective[box.key].videoUrl ? (
                    <div style={{ marginBottom: '12px' }}>
                      <video src={perspective[box.key].videoUrl} style={{ width: '100%', borderRadius: '8px', maxHeight: '200px', marginBottom: '12px' }} controls />
                      <label style={{ cursor: videoSaveStatus[box.key] === "saving" ? 'default' : 'pointer', display: 'block', fontSize: '12px', color: '#2980b9', fontWeight: '600', pointerEvents: videoSaveStatus[box.key] === "saving" ? 'none' : 'auto' }}>
                        <input type="file" accept="video/mp4,video/quicktime" onChange={(e) => handleVideoUpload(box.key, e)} style={{ display: 'none' }} disabled={videoSaveStatus[box.key] === "saving"} />
                        Replace Video
                      </label>
                    </div>
                  ) : (
                    <label style={{ cursor: videoSaveStatus[box.key] === "saving" ? 'default' : 'pointer', display: 'block', marginBottom: '12px', padding: '20px', textAlign: 'center', border: '2px dashed #ddd', borderRadius: '8px', background: '#fafafa', pointerEvents: videoSaveStatus[box.key] === "saving" ? 'none' : 'auto' }}>
                      <input type="file" accept="video/mp4,video/quicktime" onChange={(e) => handleVideoUpload(box.key, e)} style={{ display: 'none' }} disabled={videoSaveStatus[box.key] === "saving"} />
                      <span style={{ fontSize: '24px', display: 'block', marginBottom: '6px' }}></span>
                      <span style={{ fontSize: '13px', color: '#666', fontWeight: '600' }}>Click to upload video (MP4/MOV)</span>
                      <span style={{ fontSize: '11px', color: '#999', display: 'block', marginTop: '4px' }}>Max 60s, 100MB</span>
                    </label>
                  )}
                  {/* OPTIONAL DESCRIPTION */}
                  <textarea
                    placeholder={`Optional: Add a brief description or context...`}
                    value={perspective[box.key].description}
                    onChange={(e) => handleDescriptionChange(box.key, e.target.value)}
                    style={{ ...styles.input, height: '80px', fontSize: '13px' }}
                  />
                  {perspective[box.key].videoFile && (() => {
                    const isVideoSaveDisabled = videoSaveStatus[box.key] === "saving" || videoSaveStatus[box.key] === "saved";
                    return (
                      <button
                        disabled={isVideoSaveDisabled}
                        onClick={() => handleSaveVideo(box.key)}
                        style={{
                          ...styles.authButton,
                          width: '100%',
                          fontSize: '12px',
                          padding: '8px 12px',
                          marginTop: '8px',
                          backgroundColor: videoSaveStatus[box.key] === "saved" ? '#27ae60' : videoSaveStatus[box.key] === "error" ? '#e74c3c' : '#2c3e50',
                          opacity: isVideoSaveDisabled ? 0.7 : 1,
                          cursor: isVideoSaveDisabled ? 'not-allowed' : 'pointer'
                        }}>
                        {videoSaveStatus[box.key] === "saving" ? "Publishing..." : videoSaveStatus[box.key] === "saved" ? "✓ Video Published" : videoSaveStatus[box.key] === "error" ? "Failed — Retry" : "Save & Publish (+100 pts)"}
                      </button>
                    );
                  })()}
                  {perspective[box.key].videoUrl && (
                    <button
                      disabled={videoSaveStatus[box.key] === "saving"}
                      onClick={() => handleSendToDuma(box.key)}
                      style={{ ...styles.authButton, width: '100%', fontSize: '12px', padding: '8px 12px', background: '#8e44ad', marginTop: '8px', opacity: videoSaveStatus[box.key] === "saving" ? 0.5 : 1, cursor: videoSaveStatus[box.key] === "saving" ? 'not-allowed' : 'pointer' }}>
                      {dumaSubmitStatus[box.key] || "Send to Duma Culture for Voting"}
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {perspective[box.key].videoUrl ? (
                    <div>
                      <video src={perspective[box.key].videoUrl} style={{ width: '100%', borderRadius: '8px', maxHeight: '160px', marginBottom: '12px' }} controls />
                      {perspective[box.key].description && (
                        <p style={{ fontSize: '13px', color: '#666', margin: 0, marginBottom: '12px' }}>{perspective[box.key].description}</p>
                      )}
                      {videoSaveStatus[box.key] === "saved" && (
                        <p style={{ fontSize: '12px', color: '#27ae60', fontWeight: '600', marginBottom: '6px' }}>✓ Video Published</p>
                      )}
                      <button
                        onClick={() => handleSendToDuma(box.key)}
                        style={{ ...styles.authButton, width: '100%', fontSize: '12px', padding: '8px 12px', background: '#8e44ad', marginTop: '8px' }}>
                        {dumaSubmitStatus[box.key] || "Send to Duma Culture for Voting"}
                      </button>
                    </div>
                  ) : (
                    <p style={{ fontSize: '13px', color: '#aaa', minHeight: '60px', margin: '0' }}>
                      Click "Edit" to upload a video perspective...
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {editingBox && (
          <button onClick={handleSaveProfile} style={{ ...styles.authButton, width: '100%' }}>
            {saveStatus || 'Save Culture'}
          </button>
        )}
      </section>

      {/* SOCIAL LINKS SECTION */}
      <section style={{ marginBottom: '50px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: '600' }}>Connect Your Social Profiles</h2>
        <div style={styles.dumaCard}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
            {[
              { key: 'instagram', label: '\u{1F4F7} Instagram', placeholder: 'instagram.com/yourprofile' },
              { key: 'tiktok', label: '\u{1F3B5} TikTok', placeholder: 'tiktok.com/@yourprofile' },
              { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/yourprofile' },
            ].map(social => (
              <div key={social.key}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#222', display: 'block', marginBottom: '6px' }}>
                  {social.label}
                </label>
                <input
                  type="text"
                  placeholder={social.placeholder}
                  value={socialLinks[social.key]}
                  onChange={(e) => {
                    handleSocialChange(social.key, e.target.value);
                    if (socialSaveStatus[social.key] === "saved") {
                      setSocialSaveStatus(prev => ({ ...prev, [social.key]: "idle" }));
                    }
                  }}
                  style={{ ...styles.input, margin: 0, marginBottom: '6px' }} />
                <button
                  onClick={() => handleSaveSocialLink(social.key)}
                  disabled={socialSaveStatus[social.key] === "saving" || socialSaveStatus[social.key] === "saved" || !socialLinks[social.key]}
                  style={(() => {
                    const isSocialSaveDisabled = socialSaveStatus[social.key] === "saving" || socialSaveStatus[social.key] === "saved" || !socialLinks[social.key];
                    return {
                      ...styles.authButton,
                      width: '100%',
                      fontSize: '11px',
                      padding: '6px 10px',
                      backgroundColor: socialSaveStatus[social.key] === "saved" ? '#27ae60' : socialSaveStatus[social.key] === "error" ? '#e74c3c' : undefined,
                      opacity: isSocialSaveDisabled ? 0.6 : 1,
                      cursor: isSocialSaveDisabled ? 'not-allowed' : 'pointer'
                    };
                  })()}>
                  {socialSaveStatus[social.key] === "saving" ? "Saving..." : socialSaveStatus[social.key] === "saved" ? "✓ Linked" : socialSaveStatus[social.key] === "error" ? "Failed — Retry" : "Save"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CROSS-PLATFORM SHARING */}
      <section style={{ marginBottom: '50px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: '600' }}>Share to Your Socials</h2>
        <div style={{ ...styles.dumaCard, textAlign: 'center', padding: '30px' }}>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>Push your latest Perspective video to your connected social accounts</p>
          {!anyVideoPushed && (
            <p style={{ fontSize: '13px', color: '#aaa', marginBottom: '16px', fontStyle: 'italic' }}>Save & publish a Culture video above to unlock sharing.</p>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              disabled={!anyVideoPushed}
              onClick={() => handleSocialShare('Instagram', socialLinks.instagram)}
              style={{ ...styles.socialButton, maxWidth: '180px', background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)', color: '#fff', border: 'none', opacity: anyVideoPushed ? 1 : 0.4, cursor: anyVideoPushed ? 'pointer' : 'not-allowed' }}>
              Share to Instagram
            </button>
            <button
              disabled={!anyVideoPushed}
              onClick={() => handleSocialShare('TikTok', socialLinks.tiktok)}
              style={{ ...styles.socialButton, maxWidth: '180px', background: '#000', color: '#fff', border: 'none', opacity: anyVideoPushed ? 1 : 0.4, cursor: anyVideoPushed ? 'pointer' : 'not-allowed' }}>
              Share to TikTok
            </button>
            <button
              disabled={!anyVideoPushed}
              onClick={() => handleSocialShare('Facebook', socialLinks.facebook)}
              style={{ ...styles.socialButton, maxWidth: '180px', background: '#1877F2', color: '#fff', border: 'none', opacity: anyVideoPushed ? 1 : 0.4, cursor: anyVideoPushed ? 'pointer' : 'not-allowed' }}>
              Share to Facebook
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#aaa', marginTop: '12px' }}>Full API integration coming soon. Connect your accounts above to get started.</p>
        </div>
      </section>

      {/* SAVED FORMULAS SECTION */}
      <section>
        <h2 style={{ fontSize: '20px', marginBottom: '24px', fontWeight: '600' }}>Your Saved Formulas</h2>
        {savedSets.length === 0 ? (
          <div style={styles.dumaCard}>
            <p style={{ color: '#888', marginBottom: '12px' }}>You haven't saved any custom sets yet. Head home to build your first one!</p>
            <Link to="/"><button style={{ ...styles.authButton, width: '200px' }}>Start Building</button></Link>
          </div>
        ) : (
          savedSets.map((set, index) => (
            <div key={index} style={styles.dumaCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h4 style={{ margin: 0 }}>Formula #{savedSets.length - index}</h4>
                <span style={{ fontSize: '12px', color: '#888' }}>{set.date}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                {set.items.map((item, i) => (
                  <div key={i} style={{ fontSize: '12px', padding: '10px', background: '#f9f9f9', borderRadius: '8px' }}>
                    <strong>{item.name}</strong>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
};

// --- STRIPE CHECKOUT COMPONENT ---
const CheckoutForm = ({ totalPrice, onPurchaseSuccess }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [errorMessage, setErrorMessage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setIsProcessing(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/orders` },
      redirect: 'if_required'
    });
    if (error) { setErrorMessage(error.message); setIsProcessing(false); }
    else { onPurchaseSuccess(); }
  };
  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={paymentElementOptions} />
      <button disabled={!stripe || isProcessing} style={{ ...styles.authButton, marginTop: '20px' }}>
        {isProcessing ? "Processing..." : `Complete Purchase ($${totalPrice})`}
      </button>
      {errorMessage && <div style={{ color: 'red', marginTop: '10px', fontSize: '12px' }}>{errorMessage}</div>}
    </form>
  );
};

// --- FORGOT PASSWORD PAGE ---
const ForgotPasswordPage = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (response.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.authContainer}>
        <div style={{ ...styles.authCard, textAlign: 'center' }}>
          <h2>Forgot Password?</h2>
          <div style={{ fontSize: '48px', margin: '20px 0' }}></div>
          <p style={{ color: '#555', lineHeight: '1.6' }}>
            If that email is registered, we've sent a reset link.<br />
            Check your inbox (and spam folder).
          </p>
          <p style={{ color: '#888', fontSize: '13px', marginTop: '10px' }}>
            The email may have landed in your <strong>spam or junk folder</strong> - please check there if you don't see it in your inbox.
          </p>
          <Link to="/login">
            <button style={{ ...styles.authButton, marginTop: '20px' }}>Back to Sign In</button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.authContainer}>
      <div style={styles.authCard}>
        <h2>Forgot Password?</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
          Enter your email and we'll send you a link to reset your password.
        </p>
        <input
          type="email"
          placeholder="Enter your email"
          style={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p style={{ color: 'red', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
        <button style={styles.authButton} onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? "Sending..." : "Send Reset Link"}
        </button>
        <Link to="/login" style={{ display: 'block', marginTop: '15px', fontSize: '13px', color: '#666', textDecoration: 'none' }}>
          Back to Sign In
        </Link>
      </div>
    </div>
  );
};

// --- RESET PASSWORD PAGE ---
const ResetPasswordPage = () => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const { token } = useParams();

  const handleSubmit = async () => {
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      });
      const data = await response.json();
      if (response.ok) {
        setSubmitted(true);
        setTimeout(() => navigate('/login'), 3000);
      } else {
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.authContainer}>
        <div style={{ ...styles.authCard, textAlign: 'center' }}>
          <h2>Password Reset!</h2>
          <div style={{ fontSize: '48px', margin: '20px 0' }}></div>
          <p style={{ color: '#555' }}>Your password has been updated successfully.</p>
          <p style={{ color: '#888', fontSize: '13px' }}>Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.authContainer}>
      <div style={styles.authCard}>
        <h2>Reset Password</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>Enter your new password below.</p>
        <input
          type="password"
          placeholder="New password"
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          style={styles.input}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p style={{ color: 'red', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
        <button style={styles.authButton} onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? "Resetting..." : "Reset Password"}
        </button>
      </div>
    </div>
  );
};

// --- AUTH COMPONENTS ---
const LoginPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [socialError, setSocialError] = useState("");

  const handleLogin = async () => {
    setIsLoading(true);
    setSocialError("");
    try {
      const response = await fetch(`${BACKEND_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (response.ok) { onLogin(email, data.token, true, data.rank_title, data.rank_score); navigate("/profile"); }
      else { alert(data.error || "Invalid login"); }
    } catch (err) { alert("Server is waking up. Try again in 30s."); }
    finally { setIsLoading(false); }
  };

  const handleGoogleLogin = () => {
    setSocialError("");
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) { setSocialError("Google login is not configured."); return; }
    const redirectUri = window.location.origin + "/auth/google/callback";
    const scope = "openid email profile";
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&prompt=select_account`;
    window.location.href = authUrl;
  };

  const handleInstagramLogin = () => {
    setSocialError("");
    const appId = process.env.REACT_APP_FACEBOOK_APP_ID;
    if (!appId) { setSocialError("Instagram login is not configured yet."); return; }
    const redirectUri = window.location.origin + "/auth/instagram/callback";
    const scope = "email,public_profile";
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=token`;
    window.location.href = authUrl;
  };

  const handleTikTokLogin = () => {
    setSocialError("TikTok login coming soon.");
  };

  return (
    <div style={styles.authContainer}>
      <div style={{ ...styles.authCard, maxWidth: '420px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '4px', letterSpacing: '-0.5px' }}>The Majorities</h1>
        <p style={{ fontSize: '13px', color: '#888', marginBottom: '24px' }}>Sign in to your account</p>
        {socialError && <div style={{ background: '#fff0f0', color: '#c00', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>{socialError}</div>}
        <button onClick={handleGoogleLogin} style={{ ...styles.socialButton, backgroundColor: '#fff', color: '#222', border: '1px solid #ddd' }}>
          <svg style={{ width: '18px', height: '18px', marginRight: '10px' }} viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
        <button onClick={handleInstagramLogin} style={{ ...styles.socialButton, background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)', color: '#fff', border: 'none' }}>
          <svg style={{ width: '18px', height: '18px', marginRight: '10px', fill: '#fff' }} viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
          Continue with Instagram
        </button>
        <button onClick={handleTikTokLogin} style={{ ...styles.socialButton, backgroundColor: '#000', color: '#fff', border: 'none' }}>
          <svg style={{ width: '18px', height: '18px', marginRight: '10px', fill: '#fff' }} viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.42a8.21 8.21 0 0 0 4.76 1.52V6.5a4.83 4.83 0 0 1-1-.19z"/></svg>
          Continue with TikTok
        </button>
        <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#e0e0e0' }} />
          <span style={{ padding: '0 12px', fontSize: '12px', color: '#999' }}>OR</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#e0e0e0' }} />
        </div>
        <input type="email" placeholder="Email" style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" style={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} />
        <button style={styles.authButton} onClick={handleLogin}>{isLoading ? '...' : 'Login'}</button>
        <Link to="/forgot-password" style={{ display: 'block', marginTop: '12px', fontSize: '13px', color: '#666', textDecoration: 'none', textAlign: 'center' }}>
          Forgot password?
        </Link>
      </div>
    </div>
  );
};

const OAuthCallbackPage = ({ onLogin, provider }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState("Authenticating...");

  useEffect(() => {
    const hash = location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const error = params.get("error");
    if (error) { setStatus(provider + " authentication was cancelled."); setTimeout(() => navigate("/login"), 2500); return; }
    if (!accessToken) { setStatus("Authentication failed. No token received."); setTimeout(() => navigate("/login"), 2500); return; }
    const endpoint = provider === "instagram" ? "/api/auth/instagram" : "/api/auth/google";
    fetch(BACKEND_URL + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken }) })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.token) { onLogin(data.email, data.token, true, data.rank_title, data.rank_score); navigate("/profile"); }
        else { setStatus(data.error || "Account not linked. Please try again."); setTimeout(() => navigate("/login"), 3000); }
      })
      .catch(() => { setStatus("Server error. Please try again."); setTimeout(() => navigate("/login"), 3000); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={styles.authContainer}>
      <div style={{ ...styles.authCard, textAlign: 'center' }}>
        <h2 style={{ marginBottom: '12px' }}>{provider.charAt(0).toUpperCase() + provider.slice(1)}</h2>
        <p style={{ color: '#666', fontSize: '14px' }}>{status}</p>
      </div>
    </div>
  );
};

const SignupPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const handleSignup = async () => {
    if (password !== confirmPassword) return alert("Passwords do not match");
    try {
      const response = await fetch(`${BACKEND_URL}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (response.ok) { alert("Success! Log in now."); navigate("/login"); }
    } catch (err) { alert("Server error."); }
  };
  return (
    <div style={styles.authContainer}><div style={styles.authCard}>
      <h2>Sign Up</h2>
      <input type="email" placeholder="Email" style={styles.input} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Password" style={styles.input} onChange={(e) => setPassword(e.target.value)} />
      <input type="password" placeholder="Confirm" style={styles.input} onChange={(e) => setConfirmPassword(e.target.value)} />
      <button style={styles.authButton} onClick={handleSignup}>Create Account</button>
    </div></div>
  );
};

// --- LANDING PAGE ---
function LandingPage({ saveSetToProfile, onAddPoints, savedSets }) {
  const navigate = useNavigate();
  const [selection, setSelection] = useState([]);
  const [focusedItem, setFocusedItem] = useState(null);
  const [clientSecret, setClientSecret] = useState("");
  const [price] = useState(0);
  const [purchaseType] = useState(null); // "one-time" or "subscription"
  const MOBILE_BREAKPOINT = 768;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);

  useEffect(() => {
    let debounceTimer;
    const handleResize = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT), 150);
    };
    window.addEventListener('resize', handleResize);
    return () => { clearTimeout(debounceTimer); window.removeEventListener('resize', handleResize); };
  }, []);

  const handleSelect = (item) => {
    setFocusedItem(item);
    setSelection(prev => {
      const alreadySelected = prev.some(i => i.name === item.name);
      if (alreadySelected) return prev.filter(i => i.name !== item.name);
      if (prev.length >= 6) return prev;
      return [...prev, item];
    });
  };
  
  const selectedItems = selection;
  const isSetComplete = selectedItems.length === 6;
  
  // Calculate points based on purchase type
  const getPointsForPurchase = (type) => {
    if (type === "one-time") return 30;
    if (type === "subscription") {
      const subscriptionCount = (savedSets?.length || 0) + 1;
      const pointMap = {
        1: 576, 2: 1152, 3: 2304, 4: 4608, 5: 10000,
        13: 13000, 15: 15000, 20: 20000
      };
      return pointMap[subscriptionCount] || 576; // default 576 if not in special thresholds
    }
    return 0;
  };
  
  
  const onPurchaseSuccess = () => {
    const points = getPointsForPurchase(purchaseType);
    if (onAddPoints) onAddPoints(points);
    saveSetToProfile(selectedItems);
    navigate("/orders");
  };
  
  const renderRow = (label, category) => (
    <div style={styles.rowSection}>
      <h3 style={styles.rowLabel}>{label}</h3>
      <div style={styles.scrollRow}>
        {productsData[category].map(item => {
          const isSelected = selection.some(i => i.name === item.name);
          return (
            <div key={item.name} onClick={() => handleSelect(item)} style={{ ...styles.card, border: isSelected ? "2px solid #222" : "1px solid #eee" }}>
              <div style={styles.imagePlaceholder}>{item.name[0]}</div>
              <div style={styles.itemName}>{item.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
  
  return (
    <div style={{ ...styles.layout, flexDirection: isMobile ? 'column' : 'row', padding: isMobile ? '20px 16px' : '20px 60px' }}>
      <div style={{ ...styles.left, width: isMobile ? '100%' : '70%', paddingRight: isMobile ? 0 : '40px' }}>
        {renderRow("Pick Shampoos", "shampoos")}
        {renderRow("Pick Conditioners", "conditioners")}
        {renderRow("Pick Oils", "oils")}
        {renderRow("Pick Face Scrubs", "faceScrubs")}
        {renderRow("Pick Toners", "toners")}
        {renderRow("Pick Face Creams", "faceCreams")}
      </div>
      <aside style={{ ...styles.right, width: isMobile ? '100%' : '30%', position: isMobile ? 'static' : 'sticky', top: isMobile ? 'auto' : '20px', boxSizing: 'border-box' }}>
        <div style={{ minHeight: '100px', marginBottom: '15px' }}>
          {focusedItem ? (<div><h3>{focusedItem.name}</h3><p style={{ fontSize: '13px', color: '#666' }}>{focusedItem.desc}</p></div>) : <p style={{color: '#888'}}>Select a product</p>}
        </div>
        <div style={styles.summaryContainer}>
          <h4 style={{ fontSize: '14px', borderBottom: '1px solid #eee', paddingBottom: '10px', marginTop: 0 }}>Your Custom Set ({selectedItems.length}/6)</h4>
          <div style={{ margin: '10px 0' }}>
            {(() => {
              const counts = {};
              selectedItems.forEach(item => { counts[item.name] = (counts[item.name] || 0) + 1; });
              return Object.entries(counts).map(([name, count]) => (
                <p key={name} style={{ fontSize: '11px', margin: '4px 0' }}>{name}{count > 1 ? ` x${count}` : ''}</p>
              ));
            })()}
          </div>
          {isSetComplete ? (
            <div style={{ borderTop: '2px solid #222', paddingTop: '15px' }}>
              {!clientSecret ? (
                <>
                  <button style={styles.checkoutBtn} onClick={() => window.location.href = 'https://buy.stripe.com/8x228sd3w8uo2IU9Jlc7u05'}>Checkout One-Time ($36)</button>
                  <button style={{ ...styles.checkoutBtn, background: '#222', color: '#fff' }} onClick={() => window.location.href = 'https://buy.stripe.com/eVq7sMe7AbGA6ZabRtc7u06'}>Subscribe $30/mo for 6mo</button>
                </>
              ) : (
                <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
                  <CheckoutForm totalPrice={price} onPurchaseSuccess={onPurchaseSuccess} />
                  <button onClick={() => setClientSecret("")} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '11px', marginTop: '10px' }}>Change Plan</button>
                </Elements>
              )}
            </div>
          ) : <p style={{ fontSize: '12px', color: '#888' }}>Select 6 products to checkout</p>}
        </div>
      </aside>
    </div>
  );
}

// --- RECOMMEND PAGE ---
const RecommendPage = ({ addDumaItem, userEmail, rankTitle, rankScore, authToken }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ 
    name: "", 
    company: "", 
    productType: "",
    websiteLink: "",
    whyRecommend: "", 
    photo: null,
    video: null
  });
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    // Validation
    if (!formData.name || !formData.company || !formData.productType || !formData.websiteLink || !formData.whyRecommend) {
      setErrorMsg("Please fill in all required fields.");
      return;
    }

    if (formData.whyRecommend.split(' ').length < 15) {
      setErrorMsg("Justification must be at least 2-3 sentences (15+ words).");
      return;
    }

    // Check for valid URL
    try {
      new URL(formData.websiteLink);
    } catch (err) {
      setErrorMsg("Website Link must be a valid URL starting with http:// or https://");
      return;
    }

    setIsLoading(true);
    try {
      if (authToken) {
        const submitData = new FormData();
        submitData.append('name', formData.name);
        submitData.append('company', formData.company);
        submitData.append('productType', formData.productType);
        submitData.append('websiteLink', formData.websiteLink);
        submitData.append('whyRecommend', formData.whyRecommend);
        if (formData.photo) submitData.append('photo', formData.photo);
        if (formData.video) submitData.append('video', formData.video);

        const res = await fetch(`${BACKEND_URL}/api/duma/recommend`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: submitData });
        const data = await res.json();
        if (!res.ok) { setErrorMsg(data.error || 'Submission failed'); setIsLoading(false); return; }
      }
      addDumaItem({ ...formData, id: Date.now(), type: "Product Recommendation", submittedBy: userEmail || "anonymous", submitterRank: rankTitle || 'Comrade', section: "Commerce" });
      setSubmitted(true);
    } catch (err) {
      addDumaItem({ ...formData, id: Date.now(), type: "Product Recommendation", submittedBy: userEmail || "anonymous", submitterRank: rankTitle || 'Comrade', section: "Commerce" });
      setSubmitted(true);
    }
    setIsLoading(false);
  };

  if (submitted) {
    return (
      <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ ...styles.dumaCard, textAlign: 'center', padding: '50px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}></div>
          <h2 style={{ marginBottom: '10px' }}>Recommendation Submitted!</h2>
          <p style={{ color: '#666', marginBottom: '20px' }}>Your product recommendation has been sent to The Majorities' Duma Commerce section for community review and voting.</p>
          {rankTitle && <RankBadge rankTitle={rankTitle} />}
          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button style={styles.authButton} onClick={() => navigate("/duma")}>View the Duma</button>
            <button style={{ ...styles.authButton, background: '#f5f5f5', color: '#222' }} onClick={() => setSubmitted(false)}>Submit Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <h2>Submit Product Recommendation</h2>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '30px' }}>
        Submit high-quality, verified hair care products to <strong>The Majorities' Duma Commerce</strong> section for community review and voting.
      </p>

      {userEmail && rankTitle && <div style={{ marginBottom: '20px' }}><CredentialHeader email={userEmail} rankTitle={rankTitle} rankScore={rankScore} /></div>}
      {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}

      <form style={styles.dumaCard} onSubmit={handleSubmit}>
        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '15px', textTransform: 'uppercase', color: '#222' }}>1. Product Identification</h3>
          <input required placeholder="Product Name (e.g., 'Rosemary Mint Scalp & Hair Strengthening Oil') *" style={styles.input} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <input required placeholder="Company Name (legal brand name, e.g., 'Mielle Organics') *" style={styles.input} value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} />
        </div>

        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '15px', textTransform: 'uppercase', color: '#222' }}>2. Categorization & Sourcing</h3>
          <input required placeholder="Product Type (e.g., 'Moisturizer', 'Regrowth', 'Shampoo', 'Oil') *" style={styles.input} value={formData.productType} onChange={e => setFormData({...formData, productType: e.target.value})} />
          <input required type="url" placeholder="Website Link (direct product page URL, not retailer links like Amazon unless exclusive) *" style={styles.input} value={formData.websiteLink} onChange={e => setFormData({...formData, websiteLink: e.target.value})} />
        </div>

        <div style={{ marginBottom: '25px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '15px', textTransform: 'uppercase', color: '#222' }}>3. Justification & Evidence</h3>
          <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '8px' }}>Why Recommend? (2-3 sentences, focus on results) *</label>
          <textarea required placeholder="Good: 'Highly effective for type 4C hair; significantly reduced breakage within 3 weeks of consistent use without heavy buildup.' *" style={{ ...styles.input, height: '100px' }} value={formData.whyRecommend} onChange={e => setFormData({...formData, whyRecommend: e.target.value})} />

          <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginTop: '15px', marginBottom: '8px' }}>Upload Product Photo (high-resolution, label must be legible)</label>
          <input type="file" accept="image/*" style={styles.input} onChange={e => setFormData({...formData, photo: e.target.files?.[0] || null})} />

          <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginTop: '15px', marginBottom: '8px' }}>Upload Product Video (under 60s, or link to review)</label>
          <input type="file" accept="video/*" style={styles.input} onChange={e => setFormData({...formData, video: e.target.files?.[0] || null})} />
        </div>

        <button type="submit" style={styles.authButton} disabled={isLoading}>{isLoading ? "Submitting..." : "Submit to the Duma"}</button>
      </form>

      <div style={{ ...styles.dumaCard, background: '#f9f9f9', marginTop: '30px' }}>
        <h3 style={{ marginTop: 0, fontSize: '14px', fontWeight: '700' }}>Before You Submit:</h3>
        <ul style={{ fontSize: '13px', color: '#555', lineHeight: '1.8', marginLeft: '20px' }}>
          <li>Verify you are logged in with your profile (displayed above) to ensure points are tracked</li>
          <li>Double-check the Website Link for valid access before submitting</li>
          <li>Ensure product photo label is legible and high-resolution</li>
          <li>Keep video under 60 seconds</li>
          <li>Justification must be 2-3 sentences focused on results, not personal opinions</li>
        </ul>
      </div>
    </div>
  );
};

const PartnerPage = ({ addDumaItem, userEmail, rankTitle, rankScore, authToken }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: "",
    contactEmail: "",
    phoneNumber: "",
    ein: "",
    company: "",
    websiteOrSocial: "",
    countryOfOrigin: "",
    operatingCountry: "",
    productType: "",
    productDescription: "",
    whyPartner: "",
    photoFile: null,
    videoFile: null,
    unitsOf34Oz: "500",
    desiredOrderQuantity: "",
    pricing5Gallon: "",
    standardUnitPrice: "5",
    promotionalUnitPrice: "4",
    commission25AgreedTo: false,
    customerRewardAgreed: false,
    shippingReturnsAgreed: false,
    ownershipTitleAgreed: false,
    tier: "National Associate"
  });
  const [errorMsg, setErrorMsg] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);

  const userScore = rankScore || 1;
  const canApplyPremium = isPolitburoOrHigher(userScore);

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData({...formData, photoFile: file});
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleVideoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData({...formData, videoFile: file});
      setVideoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    // Validation
    if (!formData.name || !formData.contactEmail || !formData.phoneNumber || !formData.ein) {
      setErrorMsg("Please fill in all contact information fields.");
      return;
    }
    if (!formData.company || !formData.countryOfOrigin || !formData.operatingCountry) {
      setErrorMsg("Please fill in all company information fields.");
      return;
    }
    if (!formData.productType || !formData.productDescription || !formData.whyPartner) {
      setErrorMsg("Please fill in all product details.");
      return;
    }
    if (!formData.desiredOrderQuantity) {
      setErrorMsg("Please provide your desired inventory fulfillment quantity.");
      return;
    }
    if (!formData.standardUnitPrice) {
      setErrorMsg("Please provide the standard unit price to consumers.");
      return;
    }
    if (!formData.promotionalUnitPrice) {
      setErrorMsg("Please provide the promotional unit price to consumers.");
      return;
    }
    if (!formData.commission25AgreedTo) {
      setErrorMsg("You must agree to the 25% commission agreement.");
      return;
    }
    if (!formData.shippingReturnsAgreed) {
      setErrorMsg("You must agree to the Shipping & Returns Policy.");
      return;
    }
    if (!formData.ownershipTitleAgreed) {
      setErrorMsg("You must agree to the Ownership & Title Policy.");
      return;
    }

    if (formData.tier === "Premium Partner" && !canApplyPremium) {
      setErrorMsg("Premium Partner status requires Politburo rank or higher. Keep building your influence!");
      return;
    }

    try {
      if (authToken) {
        const formDataObj = new FormData();
        formDataObj.append('name', formData.name);
        formDataObj.append('contactEmail', formData.contactEmail);
        formDataObj.append('phoneNumber', formData.phoneNumber);
        formDataObj.append('ein', formData.ein);
        formDataObj.append('company', formData.company);
        formDataObj.append('websiteOrSocial', formData.websiteOrSocial);
        formDataObj.append('countryOfOrigin', formData.countryOfOrigin);
        formDataObj.append('operatingCountry', formData.operatingCountry);
        formDataObj.append('productType', formData.productType);
        formDataObj.append('productDescription', formData.productDescription);
        formDataObj.append('whyPartner', formData.whyPartner);
        formDataObj.append('unitsOf34Oz', formData.unitsOf34Oz);
        formDataObj.append('desiredOrderQuantity', formData.desiredOrderQuantity);
        formDataObj.append('pricing5Gallon', formData.pricing5Gallon);
        formDataObj.append('standardUnitPrice', formData.standardUnitPrice);
        formDataObj.append('promotionalUnitPrice', formData.promotionalUnitPrice);
        formDataObj.append('tier', formData.tier);
        if (formData.photoFile) formDataObj.append('photo', formData.photoFile);
        if (formData.videoFile) formDataObj.append('video', formData.videoFile);

        const res = await fetch(`${BACKEND_URL}/api/duma/partner`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: formDataObj
        });
        const data = await res.json();
        if (!res.ok) { setErrorMsg(data.error || 'Submission failed'); return; }
      }
      
      addDumaItem({
        ...formData,
        id: Date.now(),
        type: "Partner",
        submittedBy: userEmail,
        submitterRank: rankTitle || 'Comrade',
        hasPhoto: !!formData.photoFile,
        hasVideo: !!formData.videoFile
      });
      setSubmitted(true);
    } catch (err) {
      addDumaItem({
        ...formData,
        id: Date.now(),
        type: "Partner",
        submittedBy: userEmail,
        submitterRank: rankTitle || 'Comrade',
        hasPhoto: !!formData.photoFile,
        hasVideo: !!formData.videoFile
      });
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ ...styles.dumaCard, textAlign: 'center', padding: '50px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}></div>
          <h2>Partnership Application Submitted!</h2>
          <p style={{ color: '#666' }}>Your partnership application has been sent to The Majorities' Duma for review.</p>
          <button style={{ ...styles.authButton, marginTop: '20px', width: 'auto', padding: '12px 24px' }} onClick={() => navigate("/duma")}>View the Duma</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <h2>Partner with The Majorities</h2>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
        Apply to become a partner and sell on our marketplace
      </p>
      {userEmail && rankTitle && (
        <div style={{ marginBottom: '20px' }}>
          <CredentialHeader email={userEmail} rankTitle={rankTitle} rankScore={rankScore} />
        </div>
      )}
      {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}
      
      <form style={styles.dumaCard} onSubmit={handleSubmit}>
        
        {/* SECTION 1: CONTACT INFORMATION */}
        <div style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>1. CONTACT INFORMATION</h3>
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '14px', fontStyle: 'italic', backgroundColor: '#f9f9f9', padding: '10px', borderRadius: '6px', borderLeft: '3px solid #2980b9' }}>
            Contact information will be kept private.
          </p>
          <input required placeholder="Full Name *" style={styles.input} 
            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          <input required placeholder="Business Email *" type="email" style={styles.input} 
            value={formData.contactEmail} onChange={e => setFormData({...formData, contactEmail: e.target.value})} />
          <input required placeholder="Phone Number *" style={styles.input} 
            value={formData.phoneNumber} onChange={e => setFormData({...formData, phoneNumber: e.target.value})} />
          <input required placeholder="EIN (Employer Identification Number) *" style={styles.input} 
            value={formData.ein} onChange={e => setFormData({...formData, ein: e.target.value})} />
        </div>

        {/* SECTION 2: COMPANY INFORMATION */}
        <div style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>2. COMPANY INFORMATION</h3>
          <input required placeholder="Company Name *" style={styles.input} 
            value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} />
          <input required placeholder="Country of Origin *" style={styles.input} 
            value={formData.countryOfOrigin} onChange={e => setFormData({...formData, countryOfOrigin: e.target.value})} />
          <input required placeholder="Operating Country *" style={styles.input} 
            value={formData.operatingCountry} onChange={e => setFormData({...formData, operatingCountry: e.target.value})} />
          <input placeholder="Website or Social Media (e.g., www.yoursite.com or @yourhandle)" style={styles.input} 
            value={formData.websiteOrSocial} onChange={e => setFormData({...formData, websiteOrSocial: e.target.value})} />
        </div>

        {/* SECTION 3: PRODUCT DETAILS */}
        <div style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>3. PRODUCT DETAILS</h3>
          <input required placeholder="Product Type (e.g., Shampoo, Conditioner, Oil) *" style={styles.input} 
            value={formData.productType} onChange={e => setFormData({...formData, productType: e.target.value})} />
          <textarea required placeholder="Product Description *" style={{ ...styles.input, height: '80px' }}
            value={formData.productDescription} onChange={e => setFormData({...formData, productDescription: e.target.value})} />
          <textarea required placeholder="Why should we partner with you? *" style={{ ...styles.input, height: '100px' }}
            value={formData.whyPartner} onChange={e => setFormData({...formData, whyPartner: e.target.value})} />
        </div>

        {/* SECTION 4: MEDIA UPLOADS */}
        <div style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>4. MEDIA</h3>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Product Photo</label>
          <input type="file" accept="image/*" style={styles.input} onChange={handlePhotoChange} />
          {photoPreview && <img src={photoPreview} style={{ maxWidth: '150px', marginTop: '10px', borderRadius: '8px' }} alt="Preview" />}

          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginTop: '14px', marginBottom: '8px' }}>Product Video</label>
          <input type="file" accept="video/*" style={styles.input} onChange={handleVideoChange} />
          {videoPreview && <video src={videoPreview} style={{ maxWidth: '150px', marginTop: '10px', borderRadius: '8px' }} controls />}
        </div>

        {/* SECTION 5: LOGISTICS & REQUIREMENTS */}
        <div style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>5. LOGISTICS & REQUIREMENTS</h3>
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '14px', marginTop: 0 }}>
            Desired fulfillment of 3.4 ounce bottles
          </p>
          
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
            Fulfillment Quantity *
          </label>
          <input required placeholder="Fulfillment quantity" type="number" min="500" style={styles.input}
            value={formData.desiredOrderQuantity} onChange={e => setFormData({...formData, desiredOrderQuantity: e.target.value})} />
          <p style={{ fontSize: '11px', color: '#999', marginTop: '4px', margin: '4px 0 0 0' }}>Minimum fulfillment of 500 units</p>
          
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginTop: '14px', marginBottom: '8px' }}>
            Pricing for 5-gallon units (optional)
          </label>
          <input placeholder="Please provide pricing for bulk 5-gallon units" style={styles.input}
            value={formData.pricing5Gallon} onChange={e => setFormData({...formData, pricing5Gallon: e.target.value})} />
        </div>

        {/* SECTION 6: REVENUE AGREEMENT & PRICING */}
        <div style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>6. REVENUE AGREEMENT & PRICING</h3>
          
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
            One Time Check out: Unit Price to Consumers *
          </label>
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px', marginTop: 0 }}>
            One Time unit price (Recommended: $5)
          </p>
          <input required placeholder="e.g., $5.00" style={styles.input}
            value={formData.standardUnitPrice} onChange={e => setFormData({...formData, standardUnitPrice: e.target.value})} />
          
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginTop: '14px', marginBottom: '8px' }}>
            Subscription Pricing: Unit Price for Promotions *
          </label>
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px', marginTop: 0 }}>
            Subscription unit price (Recommended: $4)
          </p>
          <input required placeholder="e.g., $4.00" style={styles.input}
            value={formData.promotionalUnitPrice} onChange={e => setFormData({...formData, promotionalUnitPrice: e.target.value})} />
          
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', cursor: 'pointer', marginTop: '14px' }}>
            <input type="checkbox" required checked={formData.customerRewardAgreed}
              onChange={e => setFormData({...formData, customerRewardAgreed: e.target.checked})}
              style={{ marginTop: '4px', accentColor: '#222', cursor: 'pointer' }} />
            <span>I acknowledge and agree to the Customer Reward program: Customers can make a one-time purchase at the Subscription unit price for each promotion of a new rank. *</span>
          </label>
          
          <div style={{ backgroundColor: '#f5f5f5', padding: '16px', borderRadius: '8px', marginTop: '16px', marginBottom: '14px' }}>
            <p style={{ fontSize: '13px', color: '#333', margin: '0 0 10px 0', lineHeight: '1.6' }}>
              <strong>Commission Structure:</strong> The Majorities take a <strong>25%</strong> commission on all partner charges to customers.
            </p>
            {formData.standardUnitPrice && (
              <p style={{ fontSize: '12px', color: '#2980b9', margin: 0, fontWeight: '600', backgroundColor: '#e3f2fd', padding: '8px', borderRadius: '4px' }}>
                One Time: At ${formData.standardUnitPrice}, you'd earn ~${(parseFloat(formData.standardUnitPrice) * 0.75).toFixed(2)} per unit (75%), with The Majorities taking ~${(parseFloat(formData.standardUnitPrice) * 0.25).toFixed(2)} (25%)
              </p>
            )}
            {formData.promotionalUnitPrice && (
              <p style={{ fontSize: '12px', color: '#27ae60', margin: '8px 0 0 0', fontWeight: '600', backgroundColor: '#e8f8f5', padding: '8px', borderRadius: '4px' }}>
                Subscription: At ${formData.promotionalUnitPrice}, you'd earn ~${(parseFloat(formData.promotionalUnitPrice) * 0.75).toFixed(2)} per unit (75%), with The Majorities taking ~${(parseFloat(formData.promotionalUnitPrice) * 0.25).toFixed(2)} (25%)
              </p>
            )}
          </div>
          
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
            <input type="checkbox" required checked={formData.commission25AgreedTo} 
              onChange={e => setFormData({...formData, commission25AgreedTo: e.target.checked})}
              style={{ marginTop: '4px', accentColor: '#222', cursor: 'pointer' }} />
            <span>I acknowledge and agree to the 25% commission structure *</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', cursor: 'pointer', marginTop: '12px' }}>
            <input type="checkbox" required checked={formData.shippingReturnsAgreed}
              onChange={e => setFormData({...formData, shippingReturnsAgreed: e.target.checked})}
              style={{ marginTop: '4px', accentColor: '#222', cursor: 'pointer' }} />
            <span>I acknowledge and agree to The Majorities' Shipping & Returns Policy: Partners are responsible for fulfilling orders within the agreed timeframe. Returns and refunds are handled in accordance with platform guidelines, and any disputes will be reviewed by The Majorities' support team. *</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', cursor: 'pointer', marginTop: '12px' }}>
            <input type="checkbox" required checked={formData.ownershipTitleAgreed}
              onChange={e => setFormData({...formData, ownershipTitleAgreed: e.target.checked})}
              style={{ marginTop: '4px', accentColor: '#222', cursor: 'pointer' }} />
            <span>I acknowledge and agree to The Majorities' Ownership & Title Policy: I confirm that I own or have legal rights to sell the listed products, that the products meet all applicable regulations, and that title transfers to the buyer upon delivery. *</span>
          </label>
        </div>

        {/* SECTION 7: PARTNER TIER */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={styles.formSectionTitle}>7. PARTNER TIER</h3>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer' }}>
              <input type="radio" name="tier" value="National Associate"
                checked={formData.tier === "National Associate"}
                onChange={e => setFormData({...formData, tier: e.target.value})} />
              National Associate
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: canApplyPremium ? 'pointer' : 'not-allowed', opacity: canApplyPremium ? 1 : 0.5 }}>
              <input type="radio" name="tier" value="Premium Partner"
                checked={formData.tier === "Premium Partner"}
                disabled={!canApplyPremium}
                onChange={e => setFormData({...formData, tier: e.target.value})} />
              Premium Partner {!canApplyPremium && <span style={{ fontSize: '11px', color: '#aaa' }}>(Politburo+ only)</span>}
            </label>
          </div>
        </div>

        <button type="submit" style={{ ...styles.authButton, marginTop: '20px' }}>Submit partnership to the duma</button>
      </form>
    </div>
  );
};

// --- CULTURE LAB PAGE (Share Your Perspective) ---
const CultureLabPage = ({ addDumaItem, userEmail, rankTitle, rankScore, authToken, onAddPoints }) => {
  const navigate = useNavigate();
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [communitySocials, setCommunitySocials] = useState([]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/duma`)
      .then(r => { if (!r.ok) throw new Error('Failed to fetch duma'); return r.json(); })
      .then(data => {
        if (!Array.isArray(data)) return;
        const seen = new Set();
        const socials = [];
        data.forEach(item => {
          const email = item.submittedBy;
          const links = item.submitterSocialLinks;
          if (email && links && !seen.has(email) && (links.instagram || links.tiktok || links.facebook)) {
            seen.add(email);
            socials.push({ email, links, avatar: item.submitterAvatar || null, rank: item.submitterRank || 'Comrade' });
          }
        });
        setCommunitySocials(socials);
      })
      .catch(err => console.error("Failed to load community socials:", err));
  }, []);

  const prompts = [
    { id: 1, text: "Introduce yourself." },
    { id: 2, text: "Tell us what you do." },
    { id: 3, text: "What makes someone beautiful?" },
    { id: 4, text: "Thoughts about anything." }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPrompt || !response.trim()) {
      setErrorMsg("Please select a prompt and provide your response.");
      return;
    }
    
    setErrorMsg("");
    
    try {
      if (authToken) {
        const res = await fetch(`${BACKEND_URL}/api/duma/culture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            prompt: selectedPrompt,
            response: response,
            category: "Culture"
          })
        });
        const data = await res.json();
        if (!res.ok) { setErrorMsg(data.error || 'Submission failed'); return; }
      }

      // Add to local Duma and award points
      addDumaItem({
        id: Date.now(),
        type: "Culture",
        category: "Culture",
        prompt: selectedPrompt,
        response: response,
        submittedBy: userEmail,
        submitterRank: rankTitle || 'Comrade',
        votes: { yes: 0 }
      });

      if (onAddPoints) onAddPoints(1); // 1 point for submission
      
      setSubmitted(true);
      setTimeout(() => {
        navigate("/duma");
      }, 2000);
    } catch (err) {
      // Fallback to local only
      addDumaItem({
        id: Date.now(),
        type: "Culture",
        category: "Culture",
        prompt: selectedPrompt,
        response: response,
        submittedBy: userEmail,
        submitterRank: rankTitle || 'Comrade',
        votes: { yes: 0 }
      });
      if (onAddPoints) onAddPoints(1);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ ...styles.dumaCard, textAlign: 'center', padding: '50px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}></div>
          <h2 style={{ marginBottom: '10px' }}>Perspective Shared!</h2>
          <p style={{ color: '#666', marginBottom: '20px' }}>
            Your response has been submitted to The Majorities' Culture section and appears in the Duma for community voting.
          </p>
          <p style={{ fontSize: '12px', color: '#888' }}>You earned 1 point!</p>
          {rankTitle && <RankBadge rankTitle={rankTitle} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <h2>Share Your Perspective</h2>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
        Contribute to our Culture section by answering one of these prompts. 
        Submit your response to the Duma for community voting and earn points!
      </p>

      {userEmail && rankTitle && (
        <div style={{ marginBottom: '30px' }}>
          <CredentialHeader email={userEmail} rankTitle={rankTitle} rankScore={rankScore} />
        </div>
      )}

      {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}

      <form style={styles.dumaCard} onSubmit={handleSubmit}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Choose a Prompt</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          {prompts.map(prompt => (
            <label key={prompt.id} style={{
              padding: '16px',
              border: selectedPrompt === prompt.text ? '2px solid #222' : '1px solid #ddd',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: selectedPrompt === prompt.text ? '#f9f9f9' : '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <input
                type="radio"
                name="prompt"
                value={prompt.text}
                checked={selectedPrompt === prompt.text}
                onChange={(e) => setSelectedPrompt(e.target.value)}
                style={{ accentColor: '#222' }}
              />
              <span style={{ fontSize: '13px', color: '#222', fontWeight: selectedPrompt === prompt.text ? '600' : '400' }}>
                {prompt.text}
              </span>
            </label>
          ))}
        </div>

        <h3 style={{ marginTop: '24px', marginBottom: '12px' }}>Your Response</h3>
        <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0' }}>Share your thoughts (recommended: 45 seconds of speaking if recorded)</p>
        <textarea
          required
          placeholder="Type your response here..."
          style={{ ...styles.input, height: '140px' }}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
        />

        <button type="submit" style={styles.authButton}>Submit to the Duma (+1 point)</button>
      </form>

      {/* COMMUNITY SOCIAL FEED */}
      <section style={{ marginTop: '50px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '8px', fontWeight: '600' }}>Community Social Links</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>Connect with other members of The Majorities.</p>
        {communitySocials.length === 0 ? (
          <div style={{ ...styles.dumaCard, textAlign: 'center', color: '#888', padding: '30px' }}>
            No social links shared yet. Be the first — add yours in your Profile settings!
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
            {communitySocials.map(member => (
              <div key={member.email} style={{ ...styles.dumaCard, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {member.avatar ? (
                    <img src={member.avatar} alt="avatar" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>👤</div>
                  )}
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#222' }}>{member.email.split('@')[0]}</div>
                    <RankBadge rankTitle={member.rank} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {member.links.instagram && (
                    <a href={safeSocialUrl(member.links.instagram)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#c13584', textDecoration: 'none', fontWeight: '500' }}>
                      📸 Instagram
                    </a>
                  )}
                  {member.links.tiktok && (
                    <a href={safeSocialUrl(member.links.tiktok)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#222', textDecoration: 'none', fontWeight: '500' }}>
                      🎵 TikTok
                    </a>
                  )}
                  {member.links.facebook && (
                    <a href={safeSocialUrl(member.links.facebook)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#1877F2', textDecoration: 'none', fontWeight: '500' }}>
                      👍 Facebook
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

// --- DUMA PAGE ---
const DumaPage = ({ items, authToken, userEmail, rankTitle, rankScore, onAddPoints }) => {
  const [dumaItems, setDumaItems] = useState(items);
  const [userVotes, setUserVotes] = useState({});
  const [showScores, setShowScores] = useState({});
  const [showComments, setShowComments] = useState({});
  const [comments, setComments] = useState({});
  const [commentText, setCommentText] = useState({});
  const [activeSection, setActiveSection] = useState("Culture");
  
  useEffect(() => { 
    fetch(`${BACKEND_URL}/api/duma`).then(r => r.json()).then(data => { 
      if (Array.isArray(data) && data.length > 0) setDumaItems([...data, ...items]); 
    }).catch(() => {}); 
  }, [items]);
  
  const handleVote = async (itemId, voteType) => {
    if (!authToken) return alert("Please log in to vote.");
    if (userVotes[itemId]) return; // Already voted
    
    // Record user vote
    setUserVotes(prev => ({ ...prev, [itemId]: voteType }));
    
    // Show vote scores after voting
    setShowScores(prev => ({ ...prev, [itemId]: true }));
    
    // Enable comments
    setShowComments(prev => ({ ...prev, [itemId]: true }));
    
    // Award points
    if (onAddPoints) onAddPoints(1);
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/duma/${itemId}/vote`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, 
        body: JSON.stringify({ vote: voteType }) 
      });
      if (response.ok) { 
        const data = await response.json(); 
        setDumaItems(prev => prev.map(item => item.id === itemId || item._id === itemId ? { ...item, votes: data.votes || item.votes } : item)); 
      }
    } catch (err) {}
  };
  
  const handleCommentSubmit = (itemId) => {
    if (!commentText[itemId]?.trim()) return;
    setComments(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), { author: userEmail, text: commentText[itemId], timestamp: new Date().toLocaleString() }]
    }));
    setCommentText(prev => ({ ...prev, [itemId]: '' }));
  };

  const culturalItems = dumaItems.filter(item => item.section === "Cultural" || item.category === "Culture" || item.type === "Video" || item.type === "Culture");
  const commerceItems = dumaItems.filter(item => item.section === "Commerce" || (item.type === "Recommendation" || item.type === "Partner"));
  
  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px' }}>
        <div>
          <h2 style={{ marginBottom: '6px' }}>The Majorities' Duma</h2>
          <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>Community recommendations, partnerships, and cultural contributions - vote to shape The Majorities.</p>
        </div>
        {userEmail && rankTitle && <div style={{ textAlign: 'right', minWidth: '250px' }}><CredentialHeader email={userEmail} rankTitle={rankTitle} rankScore={rankScore} /></div>}
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', borderBottom: '2px solid #eee', paddingBottom: '15px' }}>
        <button onClick={() => setActiveSection("Culture")} style={{ padding: '10px 20px', backgroundColor: activeSection === "Culture" ? '#222' : '#f5f5f5', color: activeSection === "Culture" ? '#fff' : '#222', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Culture ({culturalItems.length})</button>
        <button onClick={() => setActiveSection("Commerce")} style={{ padding: '10px 20px', backgroundColor: activeSection === "Commerce" ? '#222' : '#f5f5f5', color: activeSection === "Commerce" ? '#fff' : '#222', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Commerce ({commerceItems.length})</button>
        {authToken && <button onClick={() => window.location.href = '/culture'} style={{ padding: '10px 20px', backgroundColor: '#222', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', marginLeft: 'auto' }}>+ Share Your Perspective</button>}
      </div>
      
      {activeSection === "Culture" && (
        <div>
          {culturalItems.length === 0 ? (
            <div style={{ ...styles.dumaCard, textAlign: 'center', color: '#888' }}>No perspectives shared yet. Share yours and contribute to our culture section!</div>
          ) : (
            culturalItems.map(item => (
              <div key={item.id || item._id} style={styles.dumaCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <span style={styles.typeTag}>Perspective</span>
                  {item.submitterRank && <RankBadge rankTitle={item.submitterRank} />}
                </div>
                {item.submittedBy && <CredentialHeader email={item.submittedBy} rankTitle={item.submitterRank || 'Comrade'} rankScore={null} avatarUrl={item.submitterAvatar || null} socialLinks={item.submitterSocialLinks || null} />}
                <h4 style={{ marginTop: '12px', marginBottom: '8px', color: '#555' }}>Prompt: "{item.prompt || 'What makes a person beautiful?'}"</h4>
                <p style={{ color: '#222', fontSize: '14px', lineHeight: '1.6', marginBottom: '14px' }}>{item.response || item.reason || item.desc}</p>
                
                {authToken && (
                  <div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                      <button disabled={!!userVotes[item.id || item._id]} onClick={() => handleVote(item._id || item.id, 'yes')} style={{ ...styles.voteBtn, borderColor: '#27ae60', color: '#27ae60', opacity: userVotes[item.id || item._id] === 'yes' ? 1 : 0.7 }}>Yes</button>
                      <button disabled={!!userVotes[item.id || item._id]} onClick={() => handleVote(item._id || item.id, 'no')} style={{ ...styles.voteBtn, borderColor: '#e74c3c', color: '#e74c3c', opacity: userVotes[item.id || item._id] === 'no' ? 1 : 0.7 }}>No</button>
                      <button disabled={!!userVotes[item.id || item._id]} onClick={() => handleVote(item._id || item.id, 'abstain')} style={{ ...styles.voteBtn, borderColor: '#95a5a6', color: '#95a5a6', opacity: userVotes[item.id || item._id] === 'abstain' ? 1 : 0.7 }}>Abstain</button>
                    </div>
                    
                    {showScores[item.id || item._id] && (
                      <div style={{ backgroundColor: '#f0f8ff', padding: '12px', borderRadius: '8px', marginBottom: '14px', borderLeft: '4px solid #3498db' }}>
                        <p style={{ fontSize: '12px', fontWeight: '600', color: '#2980b9', margin: '0' }}>Vote Results:</p>
                        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0 0' }}>
                          Yes: {item.votes?.yes || 0} | No: {item.votes?.no || 0} | Abstain: {item.votes?.abstain || 0}
                        </p>
                      </div>
                    )}
                    
                    {showComments[item.id || item._id] && (
                      <div style={{ borderTop: '2px solid #eee', paddingTop: '12px' }}>
                        <h4 style={{ fontSize: '13px', color: '#555', marginBottom: '12px', fontWeight: '700' }}>Comments:</h4>
                        
                        {comments[item.id || item._id]?.length > 0 && (
                          <div style={{ marginBottom: '12px' }}>
                            {comments[item.id || item._id].map((comment, idx) => (
                              <div key={idx} style={{ backgroundColor: '#f9f9f9', padding: '10px', borderRadius: '6px', marginBottom: '8px', borderLeft: '3px solid #3498db' }}>
                                <p style={{ fontSize: '11px', fontWeight: '600', color: '#222', margin: '0 0 4px 0' }}>{comment.author}</p>
                                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0' }}>{comment.text}</p>
                                <p style={{ fontSize: '10px', color: '#aaa', margin: 0 }}>{comment.timestamp}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="text" placeholder="Add a comment..." style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px' }} value={commentText[item.id || item._id] || ''} onChange={(e) => setCommentText(prev => ({ ...prev, [item.id || item._id]: e.target.value }))} />
                          <button onClick={() => handleCommentSubmit(item.id || item._id)} style={{ padding: '8px 16px', backgroundColor: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Post</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      
      {activeSection === "Commerce" && (
        <div>
          {commerceItems.length === 0 ? (
            <div style={{ ...styles.dumaCard, textAlign: 'center', color: '#888' }}>No submissions yet. Be the first to recommend a product or partnership!</div>
          ) : (
            commerceItems.map(item => (
              <div key={item.id || item._id} style={styles.dumaCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <span style={styles.typeTag}>{item.type}</span>
                  {item.submitterRank && <RankBadge rankTitle={item.submitterRank} />}
                </div>
                {item.submittedBy && <CredentialHeader email={item.submittedBy} rankTitle={item.submitterRank || 'Comrade'} rankScore={null} avatarUrl={item.submitterAvatar || null} socialLinks={item.submitterSocialLinks || null} />}
                
                {item.type === "Partner" ? (
                  <>
                    <h3 style={{ marginTop: '12px', marginBottom: '12px' }}>{item.productType} - {item.company}</h3>
                    
                    {/* PRODUCT DETAILS */}
                    <h4 style={{ marginBottom: '6px', fontSize: '13px', color: '#555', fontWeight: '700' }}>Product Details:</h4>
                    <p style={{ color: '#666', fontSize: '13px', marginBottom: '6px', lineHeight: '1.5' }}>
                      <strong>Type:</strong> {item.productType}
                    </p>
                    <p style={{ color: '#222', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>
                      <strong>Description:</strong> {item.productDescription}
                    </p>
                    <p style={{ color: '#222', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>
                      <strong>Partnership Rationale:</strong> {item.whyPartner}
                    </p>
                    
                    {/* MEDIA */}
                    {(item.hasPhoto || item.hasVideo) && (
                      <div style={{ backgroundColor: '#f5f5f5', padding: '12px', borderRadius: '8px', marginBottom: '12px', borderLeft: '4px solid #9b59b6' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '700', color: '#555' }}>Media:</h4>
                        {item.hasPhoto && <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>Product photo included</p>}
                        {item.hasVideo && <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>Product video included</p>}
                      </div>
                    )}
                    
                    {/* LOGISTICS */}
                    <div style={{ backgroundColor: '#f5f5f5', padding: '12px', borderRadius: '8px', marginBottom: '12px', borderLeft: '4px solid #27ae60' }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '700', color: '#555' }}>Logistics & Requirements:</h4>
                      <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                        <strong>Minimum Order:</strong> 500 units (3.4 oz)
                      </p>
                      {item.desiredOrderQuantity && (
                        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                          <strong>Desired Fulfillment:</strong> {item.desiredOrderQuantity} units
                        </p>
                      )}
                      {item.pricing5Gallon && (
                        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                          <strong>5-Gallon Pricing:</strong> {item.pricing5Gallon}
                        </p>
                      )}
                    </div>
                    
                    {/* REVENUE & PRICING */}
                    <div style={{ backgroundColor: '#f5f5f5', padding: '12px', borderRadius: '8px', marginBottom: '14px', borderLeft: '4px solid #e67e22' }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '700', color: '#555' }}>Revenue & Pricing:</h4>
                      {item.standardUnitPrice && (
                        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                          <strong>One Time Price:</strong> ${item.standardUnitPrice}
                        </p>
                      )}
                      {item.promotionalUnitPrice && (
                        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                          <strong>Subscription Price:</strong> ${item.promotionalUnitPrice}
                        </p>
                      )}
                      <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                        <strong>Commission:</strong> The Majorities take 25% | Partner receives 75%
                      </p>
                      <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
                        <strong>Tier:</strong> {item.tier}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ marginTop: '8px', marginBottom: '6px' }}>{item.name || item.product} by {item.company}</h3>
                    <p style={{ color: '#666', fontSize: '14px', marginBottom: '14px' }}>{item.reason || item.desc}</p>
                  </>
                )}
                
                {/* VOTING SECTION */}
                {authToken && (
                  <div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                      <button disabled={!!userVotes[item.id || item._id]} onClick={() => handleVote(item._id || item.id, 'yes')} style={{ ...styles.voteBtn, borderColor: '#27ae60', color: '#27ae60', opacity: userVotes[item.id || item._id] === 'yes' ? 1 : 0.7 }}>Yes</button>
                      <button disabled={!!userVotes[item.id || item._id]} onClick={() => handleVote(item._id || item.id, 'no')} style={{ ...styles.voteBtn, borderColor: '#e74c3c', color: '#e74c3c', opacity: userVotes[item.id || item._id] === 'no' ? 1 : 0.7 }}>No</button>
                      <button disabled={!!userVotes[item.id || item._id]} onClick={() => handleVote(item._id || item.id, 'abstain')} style={{ ...styles.voteBtn, borderColor: '#95a5a6', color: '#95a5a6', opacity: userVotes[item.id || item._id] === 'abstain' ? 1 : 0.7 }}>Abstain</button>
                    </div>
                    
                    {/* VOTE SCORES - VISIBLE ONLY AFTER VOTING */}
                    {showScores[item.id || item._id] && (
                      <div style={{ backgroundColor: '#f0f8ff', padding: '12px', borderRadius: '8px', marginBottom: '14px', borderLeft: '4px solid #3498db' }}>
                        <p style={{ fontSize: '12px', fontWeight: '600', color: '#2980b9', margin: '0' }}>Vote Results:</p>
                        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0 0' }}>
                          Yes: {item.votes?.yes || 0} | No: {item.votes?.no || 0} | Abstain: {item.votes?.abstain || 0}
                        </p>
                      </div>
                    )}
                    
                    {/* COMMENTS SECTION - VISIBLE AFTER VOTING */}
                    {showComments[item.id || item._id] && (
                      <div style={{ borderTop: '2px solid #eee', paddingTop: '12px' }}>
                        <h4 style={{ fontSize: '13px', color: '#555', marginBottom: '12px', fontWeight: '700' }}>Comments:</h4>
                        
                        {/* EXISTING COMMENTS */}
                        {comments[item.id || item._id]?.length > 0 && (
                          <div style={{ marginBottom: '12px' }}>
                            {comments[item.id || item._id].map((comment, idx) => (
                              <div key={idx} style={{ backgroundColor: '#f9f9f9', padding: '10px', borderRadius: '6px', marginBottom: '8px', borderLeft: '3px solid #3498db' }}>
                                <p style={{ fontSize: '11px', fontWeight: '600', color: '#222', margin: '0 0 4px 0' }}>{comment.author}</p>
                                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0' }}>{comment.text}</p>
                                <p style={{ fontSize: '10px', color: '#aaa', margin: 0 }}>{comment.timestamp}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* ADD COMMENT */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="text" placeholder="Add a comment..." style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px' }} value={commentText[item.id || item._id] || ''} onChange={(e) => setCommentText(prev => ({ ...prev, [item.id || item._id]: e.target.value }))} />
                          <button onClick={() => handleCommentSubmit(item.id || item._id)} style={{ padding: '8px 16px', backgroundColor: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Post</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// --- PERSPECTIVES PAGE (Personalized Feed from Following) ---
const PerspectivesPage = ({ items, authToken, userEmail, rankTitle, rankScore, following, onFollowUser, onUnfollowUser, onAddPoints }) => {
  const [followingList, setFollowingList] = useState([]);
  const [selectedFollowing, setSelectedFollowing] = useState(following || []);
  const [filteredItems, setFilteredItems] = useState(items);

  useEffect(() => {
    // Extract unique submitters from Duma posts
    const uniqueSubmitters = [...new Set(items.map(item => item.submittedBy))].filter(Boolean).filter(p => p !== userEmail);
    setFollowingList(uniqueSubmitters);
  }, [items, userEmail]);

  const handleFollowingToggle = (person) => {
    if (selectedFollowing.includes(person)) {
      onUnfollowUser?.(person);
      setSelectedFollowing(prev => prev.filter(p => p !== person));
    } else {
      onFollowUser?.(person);
      setSelectedFollowing(prev => [...prev, person]);
    }
  };

  useEffect(() => {
    if (selectedFollowing.length === 0) {
      setFilteredItems([]);
    } else {
      const filtered = items.filter(item => selectedFollowing.includes(item.submittedBy));
      setFilteredItems(filtered);
    }
  }, [selectedFollowing, items]);

  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '30px' }}>
        <h2 style={{ marginBottom: '6px' }}>My Perspectives</h2>
        <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
          Follow people from The Duma to see their perspectives in your personalized feed. Earn +1 point for each person you follow!
        </p>
      </div>

      {userEmail && rankTitle && (
        <div style={{ marginBottom: '20px' }}>
          <CredentialHeader email={userEmail} rankTitle={rankTitle} rankScore={rankScore} />
        </div>
      )}

      <div style={{ ...styles.dumaCard, marginBottom: '30px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Who You Follow ({selectedFollowing.length}/{followingList.length})</h3>
        {followingList.length === 0 ? (
          <p style={{ color: '#888', fontSize: '13px' }}>No people yet. Submit to the Duma to build your community!</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
            {followingList.map(person => (
              <button
                key={person}
                onClick={() => handleFollowingToggle(person)}
                style={{
                  padding: '12px',
                  border: selectedFollowing.includes(person) ? '2px solid #222' : '1px solid #ddd',
                  borderRadius: '8px',
                  backgroundColor: selectedFollowing.includes(person) ? '#f9f9f9' : '#fff',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: selectedFollowing.includes(person) ? '600' : '400',
                  color: '#222',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {person}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ marginBottom: '16px' }}>Perspectives Feed ({filteredItems.length})</h3>
        {filteredItems.length === 0 && selectedFollowing.length === 0 ? (
          <div style={{ ...styles.dumaCard, textAlign: 'center', color: '#888' }}>
            Select people you follow to see their perspectives here.
          </div>
        ) : selectedFollowing.length > 0 && filteredItems.length === 0 ? (
          <div style={{ ...styles.dumaCard, textAlign: 'center', color: '#888' }}>
            No perspectives yet from people you follow.
          </div>
        ) : (
          filteredItems.map(item => (
            <div key={item.id || item._id} style={styles.dumaCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <span style={styles.typeTag}>Perspective</span>
                {item.submitterRank && <RankBadge rankTitle={item.submitterRank} />}
              </div>
              {item.submittedBy && <CredentialHeader email={item.submittedBy} rankTitle={item.submitterRank || 'Comrade'} rankScore={null} avatarUrl={item.submitterAvatar || null} socialLinks={item.submitterSocialLinks || null} />}
              <h4 style={{ marginTop: '12px', marginBottom: '8px', color: '#555' }}>Prompt: "{item.prompt || 'What makes a person beautiful?'}"</h4>
              <p style={{ color: '#222', fontSize: '14px', lineHeight: '1.6' }}>{item.response || item.reason || item.desc}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [rankTitle, setRankTitle] = useState("Comrade");
  const [rankScore, setRankScore] = useState(1);
  const [savedSets, setSavedSets] = useState([]);
  const [userAvatar, setUserAvatar] = useState("");
  const [dumaItems, setDumaItems] = useState([{ id: 1, type: "Partner", company: "EcoHair Labs", product: "Silk Serum", desc: "Organic serum for hair.", section: "Commerce", submitterRank: "Comrade" }]);
  const [following, setFollowing] = useState([]);
  useEffect(() => {
    const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken");
    const email = localStorage.getItem("userEmail") || sessionStorage.getItem("userEmail");
    const storedSets = localStorage.getItem("savedSets");
    if (storedSets) { try { setSavedSets(JSON.parse(storedSets)); } catch (e) {} }
    const storedAvatar = localStorage.getItem("userAvatar") || sessionStorage.getItem("userAvatar");
    if (storedAvatar) setUserAvatar(storedAvatar);
    if (token) {
      fetch(`${BACKEND_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => {
        if (data.email) { setIsLoggedIn(true); setUserEmail(data.email); setAuthToken(token); setRankTitle(data.rank_title || 'Comrade'); setRankScore(data.rank_score || 1); localStorage.removeItem("rankTitle"); localStorage.removeItem("rankScore"); sessionStorage.removeItem("rankTitle"); sessionStorage.removeItem("rankScore"); } else { localStorage.removeItem("authToken"); localStorage.removeItem("userEmail"); sessionStorage.removeItem("authToken"); sessionStorage.removeItem("userEmail"); }
      }).catch(() => { if (email) { setIsLoggedIn(true); setUserEmail(email); setAuthToken(token); const storedRank = localStorage.getItem("rankTitle") || sessionStorage.getItem("rankTitle"); const storedScore = parseInt(localStorage.getItem("rankScore") || sessionStorage.getItem("rankScore") || "1"); if (storedRank) setRankTitle(storedRank); setRankScore(storedScore); } });
    }
  }, []);
  const handleLoginSuccess = (email, token, rememberMe, rank, score) => {
    setIsLoggedIn(true); setUserEmail(email); setAuthToken(token); const resolvedRank = rank || 'Comrade'; const resolvedScore = score || 1; setRankTitle(resolvedRank); setRankScore(resolvedScore);
    const storage = rememberMe ? localStorage : sessionStorage; storage.setItem("authToken", token); storage.setItem("userEmail", email); storage.setItem("rankTitle", resolvedRank); storage.setItem("rankScore", String(resolvedScore));
  };
  const handleLogout = () => {
    setIsLoggedIn(false); setUserEmail(""); setAuthToken(""); setRankTitle("Comrade"); setRankScore(1); setUserAvatar("");
    localStorage.removeItem("authToken"); localStorage.removeItem("userEmail"); localStorage.removeItem("rankTitle"); localStorage.removeItem("rankScore"); localStorage.removeItem("userAvatar");
    sessionStorage.removeItem("authToken"); sessionStorage.removeItem("userEmail"); sessionStorage.removeItem("rankTitle"); sessionStorage.removeItem("rankScore"); sessionStorage.removeItem("userAvatar");
  };
  const handleAvatarUpdate = (url) => {
    setUserAvatar(url);
    const storage = localStorage.getItem("authToken") ? localStorage : sessionStorage;
    if (url) { storage.setItem("userAvatar", url); } else { storage.removeItem("userAvatar"); }
  };
  const saveSetToProfile = (items) => { const newSet = { items, date: new Date().toLocaleDateString() }; const updatedSets = [newSet, ...savedSets]; setSavedSets(updatedSets); localStorage.setItem("savedSets", JSON.stringify(updatedSets)); };
  const addDumaItem = (item) => setDumaItems(prev => [item, ...prev]);
  const addPoints = useCallback((points) => {
    setRankScore(prevScore => {
      const newScore = prevScore + points;
      const newRank = getRankTitle(newScore);
      setRankTitle(newRank);
      const storage = localStorage.getItem("authToken") ? localStorage : sessionStorage;
      storage.setItem("rankScore", String(newScore));
      storage.setItem("rankTitle", newRank);
      if (authToken) {
        fetch(`${BACKEND_URL}/api/profile/add-points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ points })
        }).catch(err => console.error("Error updating points:", err));
      }
      return newScore;
    });
  }, [authToken]);

  const followUser = useCallback((personEmail) => {
    if (!following.includes(personEmail)) {
      setFollowing(prev => [...prev, personEmail]);
      addPoints(1); // +1 point for following someone
      // Notify backend to award +4 points to the person being followed
      if (authToken) {
        fetch(`${BACKEND_URL}/api/profile/follow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ followedEmail: personEmail })
        }).catch(err => console.error("Error notifying follow:", err));
      }
    }
  }, [following, addPoints, authToken]);

  const unfollowUser = (personEmail) => {
    setFollowing(prev => prev.filter(p => p !== personEmail));
  };

  return (
    <Router>
      <ScrollToTop />
      <div style={styles.pageWrapper}>
        <header style={styles.header}>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}><div style={styles.logo}>The Majorities</div></Link>
          <nav style={styles.nav}>
            <Link to="/" style={styles.navLink}>Home</Link>
            {isLoggedIn ? (
              <>
                <Link to="/recommend" style={styles.navLink}>Recommend</Link>
                <Link to="/partner" style={styles.navLink}>Partner</Link>
                <Link to="/duma" style={styles.navLink}>The Duma</Link>
                <Link to="/perspectives" style={styles.navLink}>Culture</Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '1px solid #eee', paddingLeft: '15px' }}>
                  <Link to="/profile" style={{ ...styles.navLink, fontWeight: '700' }}>Profile</Link>
                  {rankTitle && <RankBadge rankTitle={rankTitle} />}
                  <span style={styles.auth} onClick={handleLogout}>Logout</span>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <Link to="/signup" style={styles.auth}>Sign Up</Link>
                <Link to="/login" style={styles.auth}>Login</Link>
              </div>
            )}
          </nav>
        </header>
        <Routes>
          <Route path="/" element={<LandingPage saveSetToProfile={saveSetToProfile} onAddPoints={addPoints} savedSets={savedSets} />} />
          <Route path="/login" element={<LoginPage onLogin={handleLoginSuccess} />} />
          <Route path="/auth/google/callback" element={<OAuthCallbackPage onLogin={handleLoginSuccess} provider="google" />} />
          <Route path="/auth/instagram/callback" element={<OAuthCallbackPage onLogin={handleLoginSuccess} provider="instagram" />} />
          <Route path="/auth/tiktok/callback" element={<OAuthCallbackPage onLogin={handleLoginSuccess} provider="tiktok" />} />
          <Route path="/signup" element={<SignupPage onLogin={handleLoginSuccess} />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
          <Route path="/recommend" element={<RecommendPage addDumaItem={addDumaItem} userEmail={userEmail} rankTitle={rankTitle} rankScore={rankScore} authToken={authToken} />} />
          <Route path="/partner" element={<PartnerPage addDumaItem={addDumaItem} userEmail={userEmail} rankTitle={rankTitle} rankScore={rankScore} authToken={authToken} />} />
          <Route path="/culture" element={<CultureLabPage addDumaItem={addDumaItem} userEmail={userEmail} rankTitle={rankTitle} rankScore={rankScore} authToken={authToken} onAddPoints={addPoints} />} />
          <Route path="/duma" element={<DumaPage items={dumaItems} authToken={authToken} userEmail={userEmail} rankTitle={rankTitle} rankScore={rankScore} onAddPoints={addPoints} />} />
          <Route path="/perspectives" element={<PerspectivesPage items={dumaItems} authToken={authToken} userEmail={userEmail} rankTitle={rankTitle} rankScore={rankScore} following={following} onFollowUser={followUser} onUnfollowUser={unfollowUser} onAddPoints={addPoints} />} />
          <Route path="/legislature" element={<DumaPage items={dumaItems} authToken={authToken} userEmail={userEmail} rankTitle={rankTitle} rankScore={rankScore} onAddPoints={addPoints} />} />
          <Route path="/profile" element={<ProfilePage userEmail={userEmail} savedSets={savedSets} rankTitle={rankTitle} rankScore={rankScore} authToken={authToken} onAddPoints={addPoints} userAvatar={userAvatar} onAvatarUpdate={handleAvatarUpdate} />} />
          <Route path="/orders" element={<div style={{ padding: '60px', textAlign: 'center' }}><h2>Payment Received!</h2><p>Your custom hair set is being prepared. Check your Profile to see your formula.</p><Link to="/profile">Go to Profile</Link></div>} />
        </Routes>
      </div>
    </Router>
  );
}

const styles = {
  pageWrapper: { fontFamily: 'Inter, sans-serif', color: '#222' },
  header: { display: "flex", justifyContent: "space-between", padding: "15px 60px", borderBottom: "1px solid #eee", alignItems: 'center' },
  logo: { fontSize: "18px", fontWeight: "700" },
  nav: { display: "flex", gap: "25px", fontSize: "13px", alignItems: 'center' },
  navLink: { textDecoration: 'none', color: '#222', fontWeight: '500' },
  auth: { fontWeight: "600", textDecoration: 'none', color: '#222', cursor: 'pointer' },
  layout: { display: "flex", padding: "20px 60px" },
  left: { width: "70%", paddingRight: "40px" },
  right: { width: "30%", padding: "20px", borderRadius: "24px", backgroundColor: "#f9f9f9", height: "fit-content", position: 'sticky', top: '20px' },
  rowSection: { marginBottom: "20px" },
  rowLabel: { fontSize: "14px", color: "#666", fontWeight: "600", marginBottom: "10px" },
  scrollRow: { display: "flex", gap: "12px", overflowX: "auto", paddingBottom: '10px' },
  card: { minWidth: "140px", padding: "10px", borderRadius: "16px", textAlign: "center", cursor: "pointer", backgroundColor: "#fff" },
  imagePlaceholder: { width: '100%', height: '60px', backgroundColor: '#f0f0f0', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: "12px", marginTop: "6px" },
  summaryContainer: { backgroundColor: '#fff', padding: '15px', borderRadius: '20px', border: '1px solid #eee' },
  checkoutBtn: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #222', background: '#fff', cursor: 'pointer', marginBottom: '10px', fontWeight: '600' },
  authContainer: { display: 'flex', justifyContent: 'center', minHeight: '70vh', alignItems: 'center' },
  authCard: { width: '380px', padding: '30px', border: '1px solid #eee', borderRadius: '24px', textAlign: 'center' },
  input: { width: '100%', padding: '12px', margin: '8px 0', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' },
  authButton: { width: '100%', padding: '12px', backgroundColor: '#222', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
  formSectionTitle: { fontSize: '13px', fontWeight: '800', marginTop: '20px', borderBottom: '1px solid #eee', paddingBottom: '5px', textTransform: 'uppercase' },
  uploadBox: { border: '2px dashed #ddd', borderRadius: '12px', padding: '20px', textAlign: 'center', backgroundColor: '#fafafa' },
  legislatureCard: { backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '24px', padding: '30px', marginBottom: '20px' },
  typeTag: { background: '#222', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '10px' },
  perspectiveBox: { backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '16px', padding: '20px', marginBottom: '20px', position: 'relative' },
  socialButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px', transition: 'opacity 0.2s', boxSizing: 'border-box' },
  generalSecretaryBadge: { boxShadow: '0 0 8px rgba(255,215,0,0.7)', background: 'linear-gradient(90deg,#b8860b,#ffd700,#b8860b)', color: '#fff', border: 'none' },
};
