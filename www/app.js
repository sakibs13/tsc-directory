(function() {
  'use strict';

  // --- STATE ---
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

    // Show/hide filter pills based on tab
    const rolePills = document.getElementById('role-chips');
    if (rolePills) {
      rolePills.style.display = (tabName === 'directory' || tabName === 'favorites') ? 'flex' : 'none';
    }

    if (tabName === 'institutions') {
      renderInstitutions();
    } else if (tabName === 'directory' || tabName === 'favorites') {
      renderOfficers();
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
        else renderOfficers();
      });
    }

    // Role chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
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

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initData();
    setupListeners();
    renderInstitutions();
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
    activeModalCollege: null
  };
})();
