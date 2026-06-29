import React, { useState, useEffect, useRef } from 'react';
import { sendChatMessage, getChatIntent } from '../api/client';
import { useStore } from '../utils/store';

function ChatBot() {
  const setFilters = useStore((state) => state.setFilters);
  const setMapCenter = useStore((state) => state.setMapCenter);
  
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'bot', text: "Hello! I am civiSync Bot 🤖, your real-time AI civic assistant. Ask me about active warnings, potholes, or water leaks in your ward!" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messageEndRef = useRef(null);

  // Auto-scroll messages to bottom
  useEffect(() => {
    if (messageEndRef.current) {
      messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend) => {
    const text = textToSend || input;
    if (!text.trim() || loading) return;

    // Append user message
    const userMsg = { role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await sendChatMessage(text);
      const botMsg = { role: 'bot', text: response.data.response };
      setMessages((prev) => [...prev, botMsg]);

      // Call intent extraction
      const intentRes = await getChatIntent(text);
      const intent = intentRes.data;
      if (intent.has_spatial_intent) {
        let categoryMapped = null;
        if (intent.category) {
          const cat = intent.category.toLowerCase();
          if (cat.includes('pothole')) categoryMapped = 'pothole';
          else if (cat.includes('leak') || cat.includes('water')) categoryMapped = 'water_leak';
          else if (cat.includes('light') || cat.includes('streetlight')) categoryMapped = 'broken_light';
          else if (cat.includes('waste') || cat.includes('garbage')) categoryMapped = 'waste';
          else if (cat.includes('other')) categoryMapped = 'other';
        }

        let statusMapped = null;
        if (intent.status) {
          const st = intent.status.toLowerCase();
          if (st.includes('pending')) statusMapped = 'pending';
          else if (st.includes('verify')) statusMapped = 'verified';
          else if (st.includes('assign')) statusMapped = 'assigned';
          else if (st.includes('resolve')) statusMapped = 'resolved';
        }

        const filterUpdates = {};
        if (categoryMapped) {
          filterUpdates.selectedCategories = [categoryMapped];
        }
        if (statusMapped) {
          filterUpdates.selectedStatuses = [statusMapped];
        }

        if (Object.keys(filterUpdates).length > 0) {
          setFilters(filterUpdates);
        }

        if (intent.area_name) {
          const query = intent.area_name;
          try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
            const geocodeRes = await fetch(url, {
              headers: { 'User-Agent': 'civiSyncGeocoding/1.0 (Vibe2Ship HackathonClient)' }
            });
            const geoData = await geocodeRes.json();
            if (geoData && geoData.length > 0) {
              const lat = parseFloat(geoData[0].lat);
              const lon = parseFloat(geoData[0].lon);
              setMapCenter([lat, lon]);
              setMessages((prev) => [
                ...prev,
                { role: 'bot', text: `📍 Centered map on ${intent.area_name} (${lat.toFixed(4)}, ${lon.toFixed(4)}) and applied filters.` }
              ]);
            }
          } catch (geoErr) {
            console.error("Geocoding error:", geoErr);
          }
        }
      }
    } catch (err) {
      console.error(err);
      const botMsg = { role: 'bot', text: "Sorry, I'm experiencing network issues connecting to my brain. Please try again." };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetClick = (presetText) => {
    handleSend(presetText);
  };

  // Styles
  const floatingBtnStyle = {
    position: 'fixed',
    bottom: '104px', // Placed 16px above the 56px FAB (which is at bottom 32px)
    right: '20px',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    backgroundColor: '#1e293b',
    color: '#ffffff',
    border: 'none',
    fontSize: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(30, 41, 59, 0.35)',
    zIndex: 600,
    transition: 'transform 0.2s',
  };

  const chatContainerStyle = {
    position: 'fixed',
    bottom: '104px',
    right: '20px',
    width: '320px',
    maxWidth: 'calc(100% - 40px)',
    height: '420px',
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.18)',
    zIndex: 610,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'inherit',
    border: '1px solid #e5e7eb',
  };

  const headerStyle = {
    backgroundColor: '#16a34a',
    color: '#ffffff',
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const messagesWindowStyle = {
    flex: 1,
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: '#f9fafb',
  };

  const messageBubbleStyle = (role) => ({
    maxWidth: '85%',
    padding: '10px 14px',
    borderRadius: role === 'user' ? '12px 12px 0 12px' : '12px 12px 12px 0',
    fontSize: '13px',
    lineHeight: '1.45',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    backgroundColor: role === 'user' ? '#dcfce7' : '#ffffff',
    color: role === 'user' ? '#14532d' : '#1f2937',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  });

  const presetsContainerStyle = {
    padding: '8px 12px',
    backgroundColor: '#f3f4f6',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  };

  const presetBtnStyle = {
    padding: '4px 8px',
    backgroundColor: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
    color: '#4b5563',
  };

  const inputFormStyle = {
    display: 'flex',
    borderTop: '1px solid #e5e7eb',
    padding: '8px',
    backgroundColor: '#ffffff',
  };

  const inputStyle = {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '13px',
    outline: 'none',
  };

  const sendBtnStyle = {
    marginLeft: '8px',
    padding: '0 14px',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    cursor: 'pointer',
    fontWeight: 'bold',
  };

  return (
    <>
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          style={floatingBtnStyle}
          aria-label="Open Chatbot"
        >
          💬
        </button>
      ) : (
        <div style={chatContainerStyle}>
          {/* Chat Header */}
          <div style={headerStyle}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '15px' }}>civiSync Bot 🤖</span>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }}></span>
              </div>
              <span style={{ fontSize: '11px', opacity: 0.85 }}>AI Ward Assistant</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '20px', cursor: 'pointer', padding: '4px' }}
            >
              &times;
            </button>
          </div>

          {/* Chat Messages */}
          <div style={messagesWindowStyle}>
            {messages.map((msg, index) => (
              <div key={index} style={messageBubbleStyle(msg.role)}>
                {msg.text}
              </div>
            ))}
            {loading && (
              <div style={messageBubbleStyle('bot')}>
                <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  Thinking... 🧠
                </span>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>

          {/* Preset Prompts */}
          <div style={presetsContainerStyle}>
            <button type="button" onClick={() => handlePresetClick("Are there active potholes?")} style={presetBtnStyle}>
              🕳️ Potholes?
            </button>
            <button type="button" onClick={() => handlePresetClick("Show me water leaks")} style={presetBtnStyle}>
              💧 Leaks?
            </button>
            <button type="button" onClick={() => handlePresetClick("List active warning alerts")} style={presetBtnStyle}>
              📡 Alerts?
            </button>
          </div>

          {/* Chat Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            style={inputFormStyle}
          >
            <input
              type="text"
              placeholder="Ask civiSync Bot..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
            <button type="submit" style={sendBtnStyle} disabled={loading}>
              ➔
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export default ChatBot;
