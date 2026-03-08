import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import Signup from './Signup';

// --- 1. STRIPE INITIALIZATION ---
// Use your Test Publishable Key here. Avoid using pk_live during development.
const stripePromise = loadStripe("pk_test_INSERT_YOUR_TEST_PUBLISHABLE_KEY_HERE");

// --- 2. BACKEND CONFIGURATION ---
const BACKEND_URL = "http://localhost:4242";

// --- 3. UI HELPERS ---
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};

// --- 4. STRIPE UI CONFIGURATION ---
// (Removed for hosted checkout)

const productsData = {
  shampoos: [
    { name: "Hydrate Shampoo", desc: "Deep moisture for daily cleansing." },
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
  ]
};

// --- PROFILE PAGE COMPONENT ---
const ProfilePage = ({ userEmail, savedSets }) => (
  <div style={{ padding: '40px 60px', maxWidth: '900px', margin: '0 auto' }}>
    <div style={{ marginBottom: '40px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '10px' }}>Welcome back,</h1>
      <p style={{ color: '#666' }}>{userEmail}</p>
    </div>

    <section>
      <h3>Your Saved Formulas</h3>
      {savedSets.length === 0 ? (
        <div style={styles.legislatureCard}>
          <p style={{ color: '#888' }}>You haven't saved any custom sets yet. Head home to build your first one!</p>
          <Link to="/"><button style={{ ...styles.authButton, width: '200px', marginTop: '10px' }}>Start Building</button></Link>
        </div>
      ) : (
        savedSets.map((set, index) => (
          <div key={index} style={styles.legislatureCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <h4 style={{ margin: 0 }}>Formula #{savedSets.length - index}</h4>
               <span style={{ fontSize: '12px', color: '#888' }}>{set.date}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginTop: '20px' }}>
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

// --- AUTH COMPONENTS ---
const LoginPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (response.ok) {
        onLogin(email);
        navigate("/");
      } else { alert(data.error || "Invalid login"); }
    } catch (err) { alert("Server is waking up. Try again in 30s."); }
    finally { setIsLoading(false); }
  };

  return (
    <div style={styles.authContainer}><div style={styles.authCard}>
      <h2>Sign In</h2>
      <input type="email" placeholder="Email" style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Password" style={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} />
      <button style={styles.authButton} onClick={handleLogin}>{isLoading ? "..." : "Login"}</button>
    </div></div>
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
function LandingPage({ saveSetToProfile, userEmail }) {
  const navigate = useNavigate();
  const [selection, setSelection] = useState({ shampoo1: null, shampoo2: null, conditioner1: null, conditioner2: null, oil1: null, oil2: null });
  const [focusedItem, setFocusedItem] = useState(null);

  const handleSelect = (slot, item) => {
    setFocusedItem(item);
    setSelection(prev => ({ ...prev, [slot]: prev[slot]?.name === item.name ? null : item }));
  };

  const selectedItems = Object.values(selection).filter(Boolean);
  const isSetComplete = selectedItems.length === 6;

  const handleCheckout = async (type) => {
    let email = userEmail;
    if (type === 'subscription' && !userEmail) {
      alert("Please log in to subscribe.");
      navigate("/login");
      return;
    }
    if (type === 'one-time' && !userEmail) {
      email = prompt("Please enter your email for the purchase:");
      if (!email) return;
    }
    try {
      const response = await fetch(`${BACKEND_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedItems, email, type })
      });
      const { id } = await response.json();
      const stripe = await stripePromise;
      await stripe.redirectToCheckout({ sessionId: id });
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Checkout failed. Please try again.");
    }
  };

  const renderRow = (label, slot, category) => (
    <div style={styles.rowSection}>
      <h3 style={styles.rowLabel}>{label}</h3>
      <div style={styles.scrollRow}>
        {productsData[category].map(item => {
          const isSelected = selection[slot]?.name === item.name;
          return (
            <div key={item.name} onClick={() => handleSelect(slot, item)} style={{ ...styles.card, border: isSelected ? "2px solid #222" : "1px solid #eee" }}>
              <div style={styles.imagePlaceholder}>{item.name[0]}</div>
              <div style={styles.itemName}>{item.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={styles.layout}>
      <div style={styles.left}>
        {renderRow("Pick Shampoo 1", "shampoo1", "shampoos")}
        {renderRow("Pick Shampoo 2", "shampoo2", "shampoos")}
        {renderRow("Pick Conditioner 1", "conditioner1", "conditioners")}
        {renderRow("Pick Conditioner 2", "conditioner2", "conditioners")}
        {renderRow("Pick Oil 1", "oil1", "oils")}
        {renderRow("Pick Oil 2", "oil2", "oils")}
      </div>
      <aside style={styles.right}>
        <div style={{ minHeight: '100px', marginBottom: '15px' }}>
          {focusedItem ? (<div><h3>{focusedItem.name}</h3><p style={{ fontSize: '13px', color: '#666' }}>{focusedItem.desc}</p></div>) : <p style={{color: '#888'}}>Select a product</p>}
        </div>
        <div style={styles.summaryContainer}>
          <h4 style={{ fontSize: '14px', borderBottom: '1px solid #eee', paddingBottom: '10px', marginTop: 0 }}>Your Custom Set ({selectedItems.length}/6)</h4>
          <div style={{ margin: '10px 0' }}>{selectedItems.map((item, idx) => (<p key={idx} style={{ fontSize: '11px', margin: '4px 0' }}>✓ {item.name}</p>))}</div>
          {isSetComplete ? (
            <div style={{ borderTop: '2px solid #222', paddingTop: '15px' }}>
              <button style={styles.checkoutBtn} onClick={() => handleCheckout('one-time')}>Checkout One-Time ($24.99)</button>
              <button style={{ ...styles.checkoutBtn, background: '#222', color: '#fff' }} onClick={() => handleCheckout('subscription')}>Subscribe ($19.99/mo)</button>
            </div>
          ) : <p style={{ fontSize: '12px', color: '#888' }}>Select 6 products to checkout</p>}
        </div>
      </aside>
    </div>
  );
}

// --- RECOMMEND & PARTNER & LEGISLATURE ---
const RecommendPage = ({ addLegislatureItem }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ name: "", company: "", website: "", reason: "" });
  const handleSubmit = (e) => { e.preventDefault(); addLegislatureItem({ ...formData, id: Date.now(), type: "Recommendation" }); navigate("/legislature"); };
  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <h2>Recommend Products</h2>
      <form style={styles.legislatureCard} onSubmit={handleSubmit}>
        <input required placeholder="Product Name *" style={styles.input} onChange={e => setFormData({...formData, name: e.target.value})} />
        <input required placeholder="Company Name *" style={styles.input} onChange={e => setFormData({...formData, company: e.target.value})} />
        <textarea required placeholder="Reason *" style={{ ...styles.input, height: '100px' }} onChange={e => setFormData({...formData, reason: e.target.value})} />
        <button type="submit" style={styles.authButton}>Submit to Legislature</button>
      </form>
    </div>
  );
};

const PartnerPage = ({ addLegislatureItem }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ company: "", product: "", desc: "" });
  const handleSubmit = (e) => { e.preventDefault(); addLegislatureItem({ ...formData, id: Date.now(), type: "Partner" }); navigate("/legislature"); };
  return (
    <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
      <h2>Partner with The Majority</h2>
      <form style={styles.legislatureCard} onSubmit={handleSubmit}>
        <input required placeholder="Company Name *" style={styles.input} onChange={e => setFormData({...formData, company: e.target.value})} />
        <input required placeholder="Product Name *" style={styles.input} onChange={e => setFormData({...formData, product: e.target.value})} />
        <textarea required placeholder="Description *" style={styles.input} onChange={e => setFormData({...formData, desc: e.target.value})} />
        <button type="submit" style={styles.authButton}>Submit Application</button>
      </form>
    </div>
  );
};

const LegislaturePage = ({ items }) => (
  <div style={{ padding: '40px 60px', maxWidth: '1100px', margin: '0 auto' }}>
    <h2>The Majority's Legislature</h2>
    {items.map(item => (
      <div key={item.id} style={styles.legislatureCard}>
        <span style={styles.typeTag}>{item.type}</span>
        <h3>{item.name || item.product} by {item.company}</h3>
        <p>{item.reason || item.desc}</p>
      </div>
    ))}
  </div>
);

// --- MAIN APP COMPONENT ---
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [savedSets, setSavedSets] = useState([]); 
  const [legislatureItems, setLegislatureItems] = useState([
    { id: 1, type: "Partner", company: "EcoHair Labs", product: "Silk Serum", desc: "Organic serum for hair." }
  ]);

  useEffect(() => {
    const savedEmail = localStorage.getItem("userEmail");
    const storedSets = localStorage.getItem("savedSets");
    if (savedEmail) {
      setIsLoggedIn(true);
      setUserEmail(savedEmail);
    }
    if (storedSets) setSavedSets(JSON.parse(storedSets));
  }, []);

  const handleLoginSuccess = (email) => {
    setIsLoggedIn(true);
    setUserEmail(email);
    localStorage.setItem("userEmail", email);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUserEmail("");
    localStorage.removeItem("userEmail");
  };

  const saveSetToProfile = (items) => {
    const newSet = { items, date: new Date().toLocaleDateString() };
    const updatedSets = [newSet, ...savedSets];
    setSavedSets(updatedSets);
    localStorage.setItem("savedSets", JSON.stringify(updatedSets));
  };

  const addLegislatureItem = (item) => setLegislatureItems([item, ...legislatureItems]);

  return (
    <Router>
      <ScrollToTop />
      <div style={styles.pageWrapper}>
        <header style={styles.header}>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}><div style={styles.logo}>The Majority Hair Solution</div></Link>
          <nav style={styles.nav}>
            <Link to="/" style={styles.navLink}>Home</Link>
            {isLoggedIn ? (
              <>
                <Link to="/recommend" style={styles.navLink}>Recommend</Link>
                <Link to="/partner" style={styles.navLink}>Partner</Link>
                <Link to="/legislature" style={styles.navLink}>Legislature</Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '1px solid #eee', paddingLeft: '15px' }}>
                   <Link to="/profile" style={{ ...styles.navLink, fontWeight: '700' }}>Profile</Link>
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
          <Route path="/" element={<LandingPage saveSetToProfile={saveSetToProfile} userEmail={userEmail} />} />
          <Route path="/login" element={<LoginPage onLogin={handleLoginSuccess} />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/recommend" element={<RecommendPage addLegislatureItem={addLegislatureItem} />} />
          <Route path="/partner" element={<PartnerPage addLegislatureItem={addLegislatureItem} />} />
          <Route path="/legislature" element={<LegislaturePage items={legislatureItems} />} />
          <Route path="/profile" element={<ProfilePage userEmail={userEmail} savedSets={savedSets} />} />
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
};