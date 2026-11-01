(function() {
  'use strict';

  // --- STATE ---
  const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/sakibs13/tsc-directory/main/www/data/tsc_data.json';
  const LIVE_STORAGE_KEY = 'tsc_live_synced_data_v1';
  const GITHUB_NOTICES_URL = 'https://raw.githubusercontent.com/sakibs13/tsc-directory/main/www/data/notices_data.json';
  const LIVE_NOTICES_STORAGE_KEY = 'tsc_live_synced_notices_v1';
  const CURRENT_APP_VERSION = '1.0';
  const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/sakibs13/tsc-directory/main/www/data/version.json';
  const LAST_SEEN_NOTICE_KEY = 'tsc_last_seen_notice_id_v1';
  const UPDATE_DISMISSED_KEY = 'tsc_update_dismissed_until';

  let rawNotices = window.NOTICES_DATA || [];
  let activeNoticeCat = 'all';

  let rawData = window.TSC_DATA || [];
  let allOfficers = [];
  let activeTab = 'institutions'; // 'institutions', 'directory', 'favorites', 'about'
  let roleFilter = 'all';
  let divisionFilter = 'all';
  let districtFilter = 'all';
  let searchQuery = '';
  let favorites = new Set(JSON.parse(localStorage.getItem('tsc_fav_contacts') || '[]'));
  let displayedCount = 40;
  const PAGE_SIZE = 40;

  // --- EXTRACT & FLATTEN DATA ---
  function initData() {
    // Check if a newer live synced version exists in localStorage
    try {
      const cached = localStorage.getItem(LIVE_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length >= 150) {
          rawData = parsed;
        }
      }
    } catch (_) {}

    try {
      const cachedNotices = localStorage.getItem(LIVE_NOTICES_STORAGE_KEY);
      if (cachedNotices) {
        const parsedN = JSON.parse(cachedNotices);
        if (Array.isArray(parsedN) && parsedN.length > 0) {
          rawNotices = parsedN;
        }
      }
    } catch (_) {}

    allOfficers = [];
    rawData.forEach(inst => {
      // Add officers
      (inst.officers || []).forEach((off, idx) => {
        const isPrincipal = (off.designation || '').includes('অধ্যক্ষ');
        const isJr = (off.designation || '').includes('জুনিয়র');
        let role = 'instructor';
        if (isPrincipal) role = 'principal';
        else if (isJr) role = 'junior_instructor';

        const cleanMobile = (off.mobile || '').trim();
        const intlPhone = formatBanglaPhoneForCall(cleanMobile);

        allOfficers.push({
          uid: `inst-${inst.id}-off-${idx}`,
          name: off.name || '',
          designation: off.designation || '',
          office: off.office || inst.bn_name,
          email: (off.email || '').trim(),
          mobile: cleanMobile,
          intlPhone: intlPhone,
          collegeId: inst.id,
          collegeBn: inst.bn_name || inst.name,
          collegeEn: inst.name,
          division: inst.division || '',
          district: inst.district || '',
          role: role,
          isPrincipal: isPrincipal,
          isStaff: false,
          searchText: `${off.name} ${off.designation} ${inst.bn_name} ${inst.name} ${inst.district} ${inst.division} ${cleanMobile} ${off.email}`.toLowerCase()
        });
      });

      // Add staff
      (inst.staff || []).forEach((st, idx) => {
        const cleanMobile = (st.mobile || '').trim();
        const intlPhone = formatBanglaPhoneForCall(cleanMobile);
        allOfficers.push({
          uid: `inst-${inst.id}-st-${idx}`,
          name: st.name || '',
          designation: st.designation || 'কর্মচারী',
          office: inst.bn_name,
          email: (st.email || '').trim(),
          mobile: cleanMobile,
          intlPhone: intlPhone,
          collegeId: inst.id,
          collegeBn: inst.bn_name || inst.name,
          collegeEn: inst.name,
          division: inst.division || '',
          district: inst.district || '',
          role: 'staff',
          isPrincipal: false,
          isStaff: true,
          searchText: `${st.name} ${st.designation} ${inst.bn_name} ${inst.name} ${inst.district} ${inst.division} ${cleanMobile} ${st.email}`.toLowerCase()
        });
      });
    });

    populateDistrictsAndDivisions();
  }

  // Convert Bengali numerals to English for tel: and wa.me links
  function bnToEnDigits(str) {
    if (!str) return '';
    const bnNums = {'০':'0', '১':'1', '২':'2', '৩':'3', '৪':'4', '৫':'5', '৬':'6', '৭':'7', '৮':'8', '৯':'9'};
    return str.replace(/[০-৯]/g, match => bnNums[match] || match);
  }

  function formatBanglaPhoneForCall(mobileStr) {
    if (!mobileStr) return '';
    let digits = bnToEnDigits(mobileStr).replace(/\D/g, '');
    if (digits.startsWith('880')) return digits;
    if (digits.startsWith('0')) return '88' + digits;
    return digits;
  }

  // --- FILTER DROPDOWNS ---
  function populateDistrictsAndDivisions() {
    const divSelect = document.getElementById('filter-division');
    const distSelect = document.getElementById('filter-district');
    if (!divSelect || !distSelect) return;

    const divisions = [...new Set(rawData.map(i => i.division).filter(Boolean))].sort();
    divSelect.innerHTML = '<option value="all">সব বিভাগ (All Divisions)</option>' +
      divisions.map(d => `<option value="${d}">${d}</option>`).join('');

    updateDistrictOptions();
  }

  function updateDistrictOptions() {
    const distSelect = document.getElementById('filter-district');
    if (!distSelect) return;

    let filtered = rawData;
    if (divisionFilter !== 'all') {
      filtered = rawData.filter(i => i.division === divisionFilter);
    }
    const districts = [...new Set(filtered.map(i => i.district).filter(Boolean))].sort();
    distSelect.innerHTML = '<option value="all">সব জেলা (All Districts)</option>' +
      districts.map(d => `<option value="${d}">${d}</option>`).join('');
    distSelect.value = districtFilter;
  }

  // --- FILTER & SEARCH LOGIC ---
  function getFilteredInstitutions() {
    const query = searchQuery.trim().toLowerCase();
    return rawData.filter(inst => {
      if (divisionFilter !== 'all' && inst.division !== divisionFilter) return false;
      if (districtFilter !== 'all' && inst.district !== districtFilter) return false;
      if (!query) return true;

      const matchName = (inst.bn_name || '').toLowerCase().includes(query) ||
                        (inst.name || '').toLowerCase().includes(query) ||
                        (inst.district || '').toLowerCase().includes(query) ||
                        (inst.division || '').toLowerCase().includes(query) ||
                        (inst.principal_name || '').toLowerCase().includes(query) ||
                        (inst.eiin || '').includes(query) ||
                        (inst.bteb_code || '').includes(query);
      return matchName;
    });
  }

  function getFilteredOfficers() {
    const query = searchQuery.trim().toLowerCase();
    return allOfficers.filter(off => {
      // Tab check
      if (activeTab === 'favorites' && !favorites.has(off.uid)) return false;

      // Role check
      if (roleFilter !== 'all') {
        if (roleFilter === 'principal' && !off.isPrincipal) return false;
        if (roleFilter === 'instructor' && off.role !== 'instructor') return false;
        if (roleFilter === 'junior_instructor' && off.role !== 'junior_instructor') return false;
        if (roleFilter === 'staff' && !off.isStaff) return false;
      }

      // Geo check
      if (divisionFilter !== 'all' && off.division !== divisionFilter) return false;
      if (districtFilter !== 'all' && off.district !== districtFilter) return false;

      // Text search
      if (!query) return true;
      return off.searchText.includes(query);
    });
  }

  // --- RENDER INSTITUTIONS ---
  function renderInstitutions() {
    const container = document.getElementById('tsc-grid');
    const statsElem = document.getElementById('stats-text');
    if (!container) return;

    const list = getFilteredInstitutions();
    if (statsElem) {
      statsElem.innerHTML = `মোট প্রতিষ্ঠান: <span class="stats-count">${list.length}</span> টি`;
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏛️</div>
          <div class="empty-title">কোনো প্রতিষ্ঠান পাওয়া যায়নি</div>
          <div class="empty-desc">অনুসন্ধান বা ফিল্টার পরিবর্তন করে আবার চেষ্টা করুন</div>
        </div>`;
      return;
    }

    container.innerHTML = list.map(inst => {
      const offCount = (inst.officers || []).length;
      const stCount = (inst.staff || []).length;
      return `
        <div class="tsc-card" onclick="window.TSC_APP.showCollegeDetails(${inst.id})">
          <div class="tsc-card-header">
            <div>
              <div class="tsc-title-bn">${inst.bn_name || inst.name}</div>
              <div class="tsc-title-en">${inst.name}</div>
            </div>
            <span class="badge badge-primary">${inst.district}</span>
          </div>
          <div class="tsc-badge-area">
            <span class="badge">EIIN: ${inst.eiin || 'N/A'}</span>
            <span class="badge">BTEB: ${inst.bteb_code || 'N/A'}</span>
            <span class="badge">${inst.division} বিভাগ</span>
          </div>
          ${inst.principal_name ? `
            <div class="tsc-principal-info">
              <span>👤</span>
              <span><strong>অধ্যক্ষ:</strong> ${inst.principal_name}</span>
            </div>` : ''}
          <div class="tsc-card-footer">
            <div class="tsc-counts">
              <span>👨‍🏫 ${offCount} শিক্ষক</span>
              <span>👥 ${stCount} কর্মচারী</span>
            </div>
            <div class="tsc-view-link">
              <span>বিস্তারিত দেখুন</span>
              <span>→</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- RENDER DIRECTORY / FAVORITES ---
  function renderOfficers() {
    const container = document.getElementById('officer-list');
    const statsElem = document.getElementById('stats-text');
    const loadMoreBtn = document.getElementById('load-more-container');
    if (!container) return;

    const list = getFilteredOfficers();
    if (statsElem) {
      const label = activeTab === 'favorites' ? 'সংরক্ষিত পরিচিতি' : 'খুঁজে পাওয়া গেছে';
      statsElem.innerHTML = `${label}: <span class="stats-count">${list.length}</span> জন`;
    }

    if (list.length === 0) {
      const emptyMsg = activeTab === 'favorites' 
        ? 'কোনো পরিচিতি সংরক্ষিত নেই। কার্ডের স্টার (⭐) বাটনে চাপ দিয়ে প্রিয় তালিকা তৈরি করুন।'
        : 'কোনো কর্মকর্তা বা শিক্ষক পাওয়া যায়নি। ফিল্টার রিসেট করুন।';
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${activeTab === 'favorites' ? '⭐' : '🔍'}</div>
          <div class="empty-title">${activeTab === 'favorites' ? 'প্রিয় তালিকা খালি' : 'কোনো তথ্য নেই'}</div>
          <div class="empty-desc">${emptyMsg}</div>
        </div>`;
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    const visibleItems = list.slice(0, displayedCount);
    container.innerHTML = visibleItems.map(off => createOfficerCardHtml(off)).join('');

    if (loadMoreBtn) {
      loadMoreBtn.style.display = list.length > displayedCount ? 'block' : 'none';
    }
  }

  function createOfficerCardHtml(off) {
    const isFav = favorites.has(off.uid);
    let avatarClass = '';
    if (off.isPrincipal) avatarClass = 'principal';
    else if (off.isStaff) avatarClass = 'staff';

    const initial = off.name ? off.name.charAt(0) : '👨‍🏫';
    const hasPhone = !!off.intlPhone;
    const hasEmail = !!off.email;

    return `
      <div class="officer-card">
        <div class="officer-main">
          <div class="officer-avatar ${avatarClass}">${initial}</div>
          <div class="officer-details">
            <div class="officer-name">${off.name}</div>
            <div class="officer-designation">${off.designation}</div>
            <div class="officer-college">
              <span>🏛️</span>
              <span>${off.collegeBn} (${off.district})</span>
            </div>
            <div class="officer-contact-row">
              ${hasPhone ? `<span class="contact-pill phone">📞 ${off.mobile}</span>` : '<span class="contact-pill none">📞 ফোন নম্বর নেই</span>'}
              ${hasEmail ? `<span class="contact-pill email" title="${off.email}">✉️ ${off.email}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="officer-actions">
          ${hasPhone ? `
            <a href="tel:${off.intlPhone}" class="action-btn call" title="কল করুন">
              <span class="action-icon">📞</span>
              <span>কল</span>
            </a>
            <a href="https://wa.me/${off.intlPhone}" target="_blank" class="action-btn whatsapp" title="WhatsApp বার্তা পাঠান">
              <span class="action-icon">💬</span>
              <span>WhatsApp</span>
            </a>
          ` : `
            <button class="action-btn" disabled style="opacity:0.35">
              <span class="action-icon">📞</span>
              <span>কল নেই</span>
            </button>
            <button class="action-btn" disabled style="opacity:0.35">
              <span class="action-icon">💬</span>
              <span>চ্যাট</span>
            </button>
          `}
          ${hasEmail ? `
            <a href="mailto:${off.email}" class="action-btn email" title="ইমেইল করুন">
              <span class="action-icon">✉️</span>
              <span>ইমেইল</span>
            </a>
          ` : `
            <button class="action-btn" disabled style="opacity:0.35">
              <span class="action-icon">✉️</span>
              <span>মেইল নেই</span>
            </button>
          `}
          ${hasPhone ? `
            <button class="action-btn" onclick="window.TSC_APP.copyText('${off.mobile || off.intlPhone}', 'মোবাইল নম্বর কপি করা হয়েছে!')" title="নম্বর কপি করুন">
              <span class="action-icon">📋</span>
              <span>কপি</span>
            </button>
          ` : `
            <button class="action-btn" onclick="window.TSC_APP.copyText('${off.name} - ${off.designation}, ${off.collegeBn}', 'তথ্য কপি করা হয়েছে!')">
              <span class="action-icon">📋</span>
              <span>তথ্য</span>
            </button>
          `}
          <button class="action-btn star ${isFav ? 'active' : ''}" onclick="window.TSC_APP.toggleFavorite('${off.uid}')" title="প্রিয় তালিকায় রাখুন">
            <span class="action-icon">${isFav ? '★' : '☆'}</span>
          </button>
        </div>
      </div>
    `;
  }

  // --- COLLEGE DETAIL MODAL ---
  function showCollegeDetails(collegeId) {
    const inst = rawData.find(i => i.id === collegeId);
    if (!inst) return;

    const modal = document.getElementById('college-modal');
    const title = document.getElementById('sheet-title');
    const subtitle = document.getElementById('sheet-subtitle');
    const body = document.getElementById('sheet-body');
    const officersTabBtn = document.getElementById('modal-tab-officers');
    const staffTabBtn = document.getElementById('modal-tab-staff');

    if (!modal || !title || !body) return;

    title.innerText = inst.bn_name || inst.name;
    subtitle.innerHTML = `${inst.name} • ${inst.district}, ${inst.division} | EIIN: ${inst.eiin || 'N/A'}`;

    officersTabBtn.innerText = `কর্মকর্তা ও শিক্ষক (${(inst.officers || []).length})`;
    staffTabBtn.innerText = `কর্মচারী (${(inst.staff || []).length})`;

    // Default to officers tab
    window.TSC_APP.activeModalCollege = inst;
    switchModalTab('officers');

    modal.classList.add('active');
  }

  function switchModalTab(tabType) {
    const inst = window.TSC_APP.activeModalCollege;
    if (!inst) return;

    const officersTabBtn = document.getElementById('modal-tab-officers');
    const staffTabBtn = document.getElementById('modal-tab-staff');
    const body = document.getElementById('sheet-body');

    if (tabType === 'officers') {
      officersTabBtn.classList.add('active');
      staffTabBtn.classList.remove('active');
      const list = allOfficers.filter(o => o.collegeId === inst.id && !o.isStaff);
      body.innerHTML = list.length 
        ? `<div class="officer-list">${list.map(createOfficerCardHtml).join('')}</div>`
        : `<div class="empty-state"><div class="empty-desc">কোনো শিক্ষক/কর্মকর্তা তালিকাভুক্ত নেই</div></div>`;
    } else {
      officersTabBtn.classList.remove('active');
      staffTabBtn.classList.add('active');
      const list = allOfficers.filter(o => o.collegeId === inst.id && o.isStaff);
      body.innerHTML = list.length 
        ? `<div class="officer-list">${list.map(createOfficerCardHtml).join('')}</div>`
        : `<div class="empty-state"><div class="empty-desc">কোনো কর্মচারী তালিকাভুক্ত নেই</div></div>`;
    }
  }

  function closeCollegeModal() {
    const modal = document.getElementById('college-modal');
    if (modal) modal.classList.remove('active');
  }

  // --- ACTIONS ---
  function toggleFavorite(uid) {
    if (favorites.has(uid)) {
      favorites.delete(uid);
      showToast('প্রিয় তালিকা থেকে বাদ দেওয়া হয়েছে');
    } else {
      favorites.add(uid);
      showToast('প্রিয় তালিকায় যুক্ত করা হয়েছে ⭐');
    }
    localStorage.setItem('tsc_fav_contacts', JSON.stringify([...favorites]));
    if (activeTab === 'favorites') {
      renderOfficers();
    } else if (activeTab === 'directory') {
      renderOfficers();
    }
  }

  function copyText(text, msg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(msg || 'কপি করা হয়েছে!');
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(msg || 'কপি করা হয়েছে!');
    }
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  // --- RENDER NOTICES ---
  function renderNotices() {
    const container = document.getElementById('notices-list');
    const statsElem = document.getElementById('stats-text');
    if (!container) return;

    const q = searchQuery.trim().toLowerCase();
    const filtered = rawNotices.filter(n => {
      if (activeNoticeCat !== 'all' && n.category_id !== activeNoticeCat) return false;
      if (!q) return true;
      const combined = `${n.title} ${n.category_name} ${n.authority} ${n.date} ${n.issue_no}`.toLowerCase();
      return combined.includes(q);
    });

    if (statsElem) {
      statsElem.innerHTML = `মোট নোটিশ: <span class="stats-count">${filtered.length}</span> টি`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📢</div>
          <div class="empty-title">কোনো নোটিশ পাওয়া যায়নি</div>
          <div class="empty-desc">অনুসন্ধান বা ক্যাটাগরি পরিবর্তন করে আবার চেষ্টা করুন</div>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(n => {
      const catClass = n.category_id || 'dte_general';
      return `
        <div class="notice-card ${catClass}">
          <div class="notice-card-header">
            <span class="notice-badge ${catClass}">📌 ${n.category_name}</span>
            <span class="notice-date">📅 ${n.date || 'হালনাগাদ'}</span>
          </div>
          ${n.issue_no ? `<div class="notice-issue">🔢 স্মারক নং: ${n.issue_no}</div>` : ''}
          <div class="notice-title">${n.title}</div>
          <div style="font-size: 11px; color: var(--text-muted); display:flex; align-items:center; gap:4px;">
            <span>🏛️</span>
            <span>${n.authority}</span>
          </div>
          <div class="notice-actions">
            ${n.pdf_url ? `
              <a href="${n.pdf_url}" target="_blank" rel="noopener" class="notice-btn primary" title="পিডিএফ ডাউনলোড বা দেখুন">
                <span>📄</span>
                <span>PDF দেখুন / ডাউনলোড</span>
              </a>
            ` : ''}
            ${n.detail_url ? `
              <a href="${n.detail_url}" target="_blank" rel="noopener" class="notice-btn outline" title="অফিসিয়াল ওয়েবসাইট দেখুন">
                <span>🌐</span>
                <span>মূল পেজ</span>
              </a>
            ` : ''}
            <button class="notice-btn outline" onclick="window.TSC_APP.copyText('${n.pdf_url || n.detail_url}', 'নোটিশ লিংক কপি করা হয়েছে!')" title="লিংক কপি করুন">
              <span>📋</span>
              <span>কপি লিংক</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- NOTICE ALERTS & UNREAD BADGES ---
  function checkNewNoticesAlert() {
    if (!rawNotices || rawNotices.length === 0) return;
    const latestId = rawNotices[0].id || rawNotices[0].title;
    const lastSeen = localStorage.getItem(LAST_SEEN_NOTICE_KEY);
    const unreadDot = document.getElementById('notice-unread-dot');
    const banner = document.getElementById('new-notice-banner');
    const bannerTitle = document.getElementById('banner-notice-title');

    if (lastSeen !== latestId) {
      if (unreadDot) unreadDot.style.display = 'block';
      if (banner && activeTab !== 'notices') {
        if (bannerTitle) bannerTitle.textContent = rawNotices[0].title;
        banner.style.display = 'flex';
      }
    } else {
      if (unreadDot) unreadDot.style.display = 'none';
      if (banner) banner.style.display = 'none';
    }
  }

  function dismissNoticeBanner() {
    const banner = document.getElementById('new-notice-banner');
    if (banner) banner.style.display = 'none';
    if (rawNotices && rawNotices.length > 0) {
      const latestId = rawNotices[0].id || rawNotices[0].title;
      localStorage.setItem(LAST_SEEN_NOTICE_KEY, latestId);
    }
    const unreadDot = document.getElementById('notice-unread-dot');
    if (unreadDot) unreadDot.style.display = 'none';
  }

  function openNoticesFromBanner() {
    dismissNoticeBanner();
    switchTab('notices');
  }

  // --- IN-APP UPDATE SYSTEM ---
  async function checkAppUpdate(isManual = false) {
    const checkBtn = document.getElementById('check-update-btn');
    if (isManual && checkBtn) checkBtn.classList.add('rotating');

    try {
      const res = await fetch(GITHUB_VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        const remoteVer = parseFloat(info.version || '1.0');
        const currentVer = parseFloat(CURRENT_APP_VERSION);

        if (remoteVer > currentVer) {
          const dismissedUntil = parseInt(localStorage.getItem(UPDATE_DISMISSED_KEY) || '0', 10);
          if (isManual || Date.now() > dismissedUntil) {
            showUpdateModal(info);
            return;
          }
        } else if (isManual) {
          showToast('আপনি লেটেস্ট সংস্করণ (' + CURRENT_APP_VERSION + ') ব্যবহার করছেন 👍');
        }
      } else if (isManual) {
        showToast('আপডেট তথ্য লোড করা যায়নি।');
      }
    } catch (err) {
      console.warn('Update check error:', err);
      if (isManual) showToast('ইন্টারনেট সংযোগ চেক করুন।');
    } finally {
      if (isManual && checkBtn) checkBtn.classList.remove('rotating');
    }
  }

  function showUpdateModal(info) {
    const modal = document.getElementById('update-modal');
    if (!modal) return;
    const titleEl = document.getElementById('update-title');
    const verEl = document.getElementById('update-version-label');
    const listEl = document.getElementById('update-features-list');
    const btnEl = document.getElementById('update-download-btn');

    if (titleEl && info.title) titleEl.textContent = info.title;
    if (verEl && info.version) verEl.textContent = 'ভার্সন v' + info.version;
    if (btnEl && info.downloadUrl) btnEl.href = info.downloadUrl;
    if (listEl && Array.isArray(info.whatsNew)) {
      listEl.innerHTML = info.whatsNew.map(item => `<li>${item}</li>`).join('');
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
    localStorage.setItem(UPDATE_DISMISSED_KEY, String(Date.now() + 24 * 3600 * 1000));
  }

  // --- TAB NAVIGATION ---
  function switchTab(tabName) {
    activeTab = tabName;
    displayedCount = PAGE_SIZE;

    // Update nav icons
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Update sections
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.remove('active');
    });

    const target = document.getElementById(`view-${tabName}`);
    if (target) target.classList.add('active');

    // Show/hide filter pills & dropdowns based on tab
    const rolePills = document.getElementById('role-chips');
    if (rolePills) {
      rolePills.style.display = (tabName === 'directory' || tabName === 'favorites') ? 'flex' : 'none';
    }

    const geoFilters = document.querySelector('.filter-dropdowns');
    if (geoFilters) {
      geoFilters.style.display = (tabName === 'institutions' || tabName === 'directory') ? 'grid' : 'none';
    }

    if (tabName === 'institutions') {
      renderInstitutions();
    } else if (tabName === 'directory' || tabName === 'favorites') {
      renderOfficers();
    } else if (tabName === 'notices') {
      dismissNoticeBanner();
      renderNotices();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- THEME TOGGLE ---
  function initTheme() {
    const saved = localStorage.getItem('tsc_theme') || 'light';
    setTheme(saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tsc_theme', theme);
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  // --- EVENT LISTENERS ---
  function setupListeners() {
    // Search input
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        if (clearBtn) clearBtn.style.display = searchQuery ? 'block' : 'none';
        displayedCount = PAGE_SIZE;
        if (activeTab === 'institutions') renderInstitutions();
        else if (activeTab === 'notices') renderNotices();
        else renderOfficers();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        searchQuery = '';
        clearBtn.style.display = 'none';
        displayedCount = PAGE_SIZE;
        if (activeTab === 'institutions') renderInstitutions();
        else if (activeTab === 'notices') renderNotices();
        else renderOfficers();
      });
    }

    // Notice category chips
    document.querySelectorAll('[data-notice-cat]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-notice-cat]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeNoticeCat = chip.getAttribute('data-notice-cat');
        renderNotices();
      });
    });

    // Role chips
    document.querySelectorAll('#role-chips .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        roleFilter = chip.getAttribute('data-role');
        displayedCount = PAGE_SIZE;
        renderOfficers();
      });
    });

    // Division select
    const divSelect = document.getElementById('filter-division');
    if (divSelect) {
      divSelect.addEventListener('change', (e) => {
        divisionFilter = e.target.value;
        districtFilter = 'all';
        updateDistrictOptions();
        displayedCount = PAGE_SIZE;
        if (activeTab === 'institutions') renderInstitutions();
        else if (activeTab === 'notices') renderNotices();
        else renderOfficers();
      });
    }

    // District select
    const distSelect = document.getElementById('filter-district');
    if (distSelect) {
      distSelect.addEventListener('change', (e) => {
        districtFilter = e.target.value;
        displayedCount = PAGE_SIZE;
        if (activeTab === 'institutions') renderInstitutions();
        else if (activeTab === 'notices') renderNotices();
        else renderOfficers();
      });
    }

    // Navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        switchTab(tab.getAttribute('data-tab'));
      });
    });

    // Load more button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        displayedCount += PAGE_SIZE;
        renderOfficers();
      });
    }

    // Close modal on backdrop click
    const modal = document.getElementById('college-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCollegeModal();
      });
    }
  }

  // --- REMOTE GITHUB SYNC ---
  async function syncFromGitHub(isManual = false) {
    const syncBtn = document.getElementById('sync-data-btn');
    if (syncBtn) syncBtn.classList.add('rotating');
    if (isManual) showToast('ক্লাউড থেকে তথ্য চেক করা হচ্ছে...');

    try {
      const res = await fetch(GITHUB_RAW_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const freshData = await res.json();
      if (Array.isArray(freshData) && freshData.length >= 150) {
        const oldStr = localStorage.getItem(LIVE_STORAGE_KEY) || JSON.stringify(window.TSC_DATA || []);
        const newStr = JSON.stringify(freshData);
        if (oldStr !== newStr) {
          localStorage.setItem(LIVE_STORAGE_KEY, newStr);
          rawData = freshData;
          initData();
          if (activeTab === 'institutions') renderInstitutions();
          else renderOfficers();
          showToast('✨ সর্বশেষ তথ্য সফলভাবে হালনাগাদ হয়েছে!');
        } else if (isManual) {
          showToast('অ্যাপের তথ্য ইতিমধ্যে সম্পূর্ণ আপ-টু-ডেট আছে 👍');
        }
      }

      // Sync Notices as well
      try {
        const resN = await fetch(GITHUB_NOTICES_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (resN.ok) {
          const freshN = await resN.json();
          if (Array.isArray(freshN) && freshN.length > 0) {
            localStorage.setItem(LIVE_NOTICES_STORAGE_KEY, JSON.stringify(freshN));
            rawNotices = freshN;
            checkNewNoticesAlert();
            if (activeTab === 'notices') renderNotices();
          }
        }
      } catch (_) {}
    } catch (err) {
      console.warn('Live sync notice:', err);
      if (isManual) showToast('ইন্টারনেট সংযোগ নেই, অফলাইন ডাটা সচল আছে।');
    } finally {
      if (syncBtn) syncBtn.classList.remove('rotating');
    }
  }

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initData();
    setupListeners();
    renderInstitutions();
    checkNewNoticesAlert();
    // Silent background check if online
    setTimeout(() => {
      if (navigator.onLine) {
        syncFromGitHub(false);
        checkAppUpdate(false);
      }
    }, 2500);
  });

  // Global exposure for event handlers
  window.TSC_APP = {
    showCollegeDetails,
    closeCollegeModal,
    switchModalTab,
    toggleFavorite,
    copyText,
    switchTab,
    toggleTheme,
    syncFromGitHub,
    checkAppUpdate,
    closeUpdateModal,
    openNoticesFromBanner,
    dismissNoticeBanner,
    activeModalCollege: null
  };
})();
