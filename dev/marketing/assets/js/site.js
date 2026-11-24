import '../../../assets/css/root.css';
import '../../../assets/fonts/stratops/style.css';
import '../css/site.css';
// import './icon-fallback.js';
import '../css/pages.css';
import './contact.js';

/* StratOps public marketing interactions.
   No dependencies. This file does not touch the operational globe or its trackers. */
(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("has-js");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const header = document.getElementById("site-header");
  const progressBar = document.getElementById("reading-progress-bar");
  const menuButton = document.querySelector(".mobile-menu-button");
  const navigation = document.getElementById("site-navigation");
  const year = document.getElementById("footer-year");
  if (year) year.textContent = String(new Date().getFullYear());

  // Scroll progress + sticky header + lightweight parallax using transforms.
  // Avoid background-attachment: fixed (unreliable on iOS Safari).
  const parallaxItems = Array.from(document.querySelectorAll("[data-parallax]"));
  let framePending = false;

  function renderScrollState() {
    framePending = false;
    const scrollY = window.scrollY || root.scrollTop || 0;
    const travel = Math.max(1, root.scrollHeight - window.innerHeight);
    const percent = Math.max(0, Math.min(100, (scrollY / travel) * 100));

    if (header) header.classList.toggle("is-scrolled", scrollY > 55);
    if (progressBar) progressBar.style.width = percent.toFixed(2) + "%";

    if (reducedMotion.matches) return;
    for (const item of parallaxItems) {
      const rect = item.getBoundingClientRect();
      if (rect.bottom < -120 || rect.top > window.innerHeight + 120) continue;
      const depth = Number(item.dataset.depth) || 0.08;
      const distanceFromCenter = rect.top + rect.height / 2 - window.innerHeight / 2;
      const amount = Math.max(-85, Math.min(85, -distanceFromCenter * depth));
      item.style.setProperty("--parallax-y", amount.toFixed(2) + "px");
    }
  }

  function requestScrollRender() {
    if (!framePending) {
      framePending = true;
      window.requestAnimationFrame(renderScrollState);
    }
  }
  window.addEventListener("scroll", requestScrollRender, { passive: true });
  window.addEventListener("resize", requestScrollRender, { passive: true });
  requestScrollRender();

  // Mobile navigation and native-feeling smooth in-page anchor navigation.
  function closeMenu() {
    if (!header || !menuButton) return;
    header.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
  }
  if (menuButton && header && navigation) {
    menuButton.addEventListener("click", () => {
      const opening = !header.classList.contains("is-open");
      header.classList.toggle("is-open", opening);
      menuButton.setAttribute("aria-expanded", String(opening));
      menuButton.setAttribute("aria-label", opening ? "Close navigation" : "Open navigation");
    });
    navigation.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && header.classList.contains("is-open")) {
        closeMenu();
        menuButton.focus();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (header.classList.contains("is-open") && !header.contains(event.target)) closeMenu();
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const selector = anchor.getAttribute("href");
      if (!selector || selector === "#") return;
      const target = document.getElementById(selector.slice(1));
      if (!target) return;
      event.preventDefault();
      closeMenu();
      target.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
      if (window.history && history.replaceState) history.replaceState(null, "", selector);
      if (selector === "#main") target.focus({ preventScroll: true });
    });
  });

  // Progressive reveal: visible without JS, and still visible with reduced motion.
  const revealNodes = document.querySelectorAll("[data-reveal]");
  function showEverything() { revealNodes.forEach((item) => item.classList.add("is-visible")); }
  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -35px 0px", threshold: 0.07 });
    revealNodes.forEach((node) => revealObserver.observe(node));
  } else {
    showEverything();
  }

  // Domain cards, accessible as real buttons. Mouse drag + touch native swipe.
  const domains = {
    air: {
      title: "Military aviation", index: "D/ 01",
      description: "Select an observed military track to see altitude, speed, callsign, identity evidence and source age, then replay its collected history. A missing signal is not proof an aircraft is absent."
    },
    sea: {
      title: "Naval activity", index: "D/ 02",
      description: "Compare AIS contacts with published exercises, deployments and port visits, kept visibly separate. A publication location is a report, not a live ship position."
    },
    orbit: {
      title: "Orbital intelligence", index: "D/ 03",
      description: "Follow public military-associated and dual-use satellites by NORAD identity, with predicted ground tracks and data age. Orbits are modeled, not detections, and imagery records are separate."
    },
    notam: {
      title: "NOTAM intelligence", index: "D/ 04",
      description: "Check whether a published notice overlaps your theater. See its geometry, validity window and source text, then capture the map view. It is a reference, not an official flight briefing."
    },
    gnss: {
      title: "GNSS monitoring", index: "D/ 05",
      description: "Compare reported GNSS degradation by area, severity and observation window, and look for patterns next to other context. Degradation alone does not locate a jammer or name who is responsible."
    },
    conflict: {
      title: "Conflict intelligence", index: "D/ 06",
      description: "Browse reported missile, drone and strike events with sources, dates and location precision, alongside regional hotspots. Reports can be late, incomplete or corrected."
    },
    aoi: {
      title: "Area of Interest intelligence", index: "D/ 07",
      description: "Draw an area to summarize the bases, observed assets and reported incidents in and around it. Edit the shape as your question changes. An empty result never proves absence."
    },
    imagery: {
      title: "Satellite observations", index: "D/ 08",
      description: "Open eligible event-linked imagery records with acquisition dates, locations and source metadata. When an image was captured is not where a satellite is now."
    },
    cyber: {
      title: "Cyber & infrastructure", index: "D/ 09",
      description: "See source-attributed cyber reports and internet disruptions in their geographic setting. An outage or advisory is context, not automatic proof of an attack."
    }
  };
  const rail = document.getElementById("domain-rail");
  const cards = rail ? Array.from(rail.querySelectorAll(".domain-card")) : [];
  const railCount = document.getElementById("rail-count");
  const prev = document.getElementById("rail-prev");
  const next = document.getElementById("rail-next");
  const title = document.getElementById("domain-detail-title");
  const description = document.getElementById("domain-detail-text");
  const index = document.getElementById("domain-detail-index");
  const note = document.getElementById("domain-detail-note");
  const detail = document.getElementById("domain-detail");

  function selectDomain(button) {
    const info = domains[button.dataset.domain];
    if (!info) return;
    cards.forEach((card) => {
      const active = card === button;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
    });
    if (title) title.textContent = info.title;
    if (description) description.textContent = info.description;
    if (index) {
      // Preserve the two original child spans (D/ and 01) on every selection.
      const number = info.index.split('/').pop().trim();
      const prefix = document.createElement('span');
      prefix.textContent = 'D/';
      const value = document.createElement('span');
      value.textContent = number;
      index.replaceChildren(prefix, value);
    }
    if (note) note.textContent = info.note;
    // A tiny, opt-out transition when switching the existing domain detail.
    if (detail && !reducedMotion.matches) {
      detail.classList.remove("is-refreshed");
      void detail.offsetWidth;
      detail.classList.add("is-refreshed");
    }
    if (railCount) railCount.textContent = info.index.slice(-2) + " / " + String(cards.length).padStart(2, "0");
  }

  if (rail && cards.length) {
    let dragging = false;
    let dragMoved = false;
    let suppressClick = false;
    let startX = 0;
    let startScroll = 0;

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        if (!suppressClick) selectDomain(card);
      });
    });

    function updateRailButtons() {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
      if (prev) prev.disabled = rail.scrollLeft <= 4;
      if (next) next.disabled = rail.scrollLeft >= maxScroll - 4;
    }
    function railStep(direction) {
      const width = cards[0].getBoundingClientRect().width + 14;
      rail.scrollBy({ left: direction * width, behavior: reducedMotion.matches ? "auto" : "smooth" });
    }
    if (prev) prev.addEventListener("click", () => railStep(-1));
    if (next) next.addEventListener("click", () => railStep(1));
    rail.addEventListener("scroll", updateRailButtons, { passive: true });
    window.addEventListener("resize", updateRailButtons, { passive: true });
    updateRailButtons();

    rail.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      dragging = true;
      dragMoved = false;
      startX = event.clientX;
      startScroll = rail.scrollLeft;
    });
    rail.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerType !== "mouse") return;
      const distance = event.clientX - startX;
      if (Math.abs(distance) > 6) {
        if (!dragMoved) {
          dragMoved = true;
          rail.classList.add("is-dragging");
          try { rail.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
        }
        rail.scrollLeft = startScroll - distance;
      }
    });
    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove("is-dragging");
      if (dragMoved) {
        suppressClick = true;
        window.setTimeout(() => { suppressClick = false; }, 30);
      }
    }
    rail.addEventListener("pointerup", stopDrag);
    rail.addEventListener("pointercancel", stopDrag);
    rail.addEventListener("lostpointercapture", stopDrag);
    rail.addEventListener("click", (event) => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }

  // Footer and hero links can jump straight to a domain: select its card and bring it into view.
  document.querySelectorAll("[data-domain-link]").forEach((link) => {
    link.addEventListener("click", () => {
      const card = cards.find((c) => c.dataset.domain === link.dataset.domainLink);
      if (!card) return;
      selectDomain(card);
      if (!rail) return;
      const pad = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
      const delta = card.getBoundingClientRect().left - rail.getBoundingClientRect().left - pad;
      rail.scrollBy({ left: delta, behavior: reducedMotion.matches ? "auto" : "smooth" });
    });
  });

  // Workflow timeline: start the dot-to-dot sequence once, when it scrolls into view.
  const timeline = document.querySelector(".workflow-steps");
  if (timeline) {
    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      timeline.classList.add("is-playing");
    } else {
      const timelineObserver = new IntersectionObserver((entries, observer) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        timeline.classList.add("is-playing");
        observer.disconnect();
      }, { rootMargin: "0px 0px -18% 0px", threshold: 0.15 });
      timelineObserver.observe(timeline);
    }
  }

  // Native, keyboard-accessible chapter details with smooth expand AND collapse.
  // Keep the <details> open while collapsing, then close it after the animation.
  document.querySelectorAll('details.chapter-details').forEach((details) => {
    const summary = details.querySelector('summary');
    const content = details.querySelector('.chapter-details-body');
    if (!summary || !content) return;
    let animation = null;
    let expanded = details.open;
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      const opening = !expanded;
      expanded = opening;
      if (animation) { animation.onfinish = null; animation.cancel(); animation = null; }
      if (reducedMotion.matches || typeof content.animate !== 'function') {
        details.open = opening;
        content.style.height = '';
        content.style.overflow = '';
        return;
      }
      const startHeight = content.getBoundingClientRect().height;
      if (opening) details.open = true;
      content.style.overflow = 'hidden';
      const targetHeight = opening ? content.scrollHeight : 0;
      content.style.height = `${startHeight}px`;
      animation = content.animate([
        { height: `${startHeight}px`, opacity: opening ? 0.55 : 1 },
        { height: `${targetHeight}px`, opacity: opening ? 1 : 0.55 }
      ], { duration: 400, easing: 'cubic-bezier(.2,.7,.2,1)' });
      animation.onfinish = () => {
        details.open = expanded;
        content.style.height = '';
        content.style.overflow = '';
        animation = null;
      };
    });
  });

  // Smooth accordion: the panel height animates via CSS (grid-template-rows).
  // JS only flips state, keeps ARIA in sync and allows one open item at a time.
  const faqItems = Array.from(document.querySelectorAll(".faq-item"));
  function setFaq(item, open) {
    const trigger = item.querySelector(".faq-trigger");
    item.classList.toggle("is-open", open);
    if (trigger) trigger.setAttribute("aria-expanded", String(open));
  }
  faqItems.forEach((item) => {
    const trigger = item.querySelector(".faq-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", () => {
      const open = !item.classList.contains("is-open");
      faqItems.forEach((other) => { if (other !== item) setFaq(other, false); });
      setFaq(item, open);
    });
  });

  // Accessible preview tabs: click plus left/right/Home/End keyboard controls.
  const modeTabs = Array.from(document.querySelectorAll('[role="tab"][data-mode]'));
  const modePanels = modeTabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
  function setMode(activeIndex, focus) {
    modeTabs.forEach((tab, i) => {
      const selected = i === activeIndex;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (modePanels[i]) modePanels[i].hidden = !selected;
    });
    if (focus && modeTabs[activeIndex]) modeTabs[activeIndex].focus();
  }
  modeTabs.forEach((tab, i) => {
    tab.addEventListener("click", () => setMode(i, false));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (i + 1) % modeTabs.length;
      if (event.key === "ArrowLeft") nextIndex = (i + modeTabs.length - 1) % modeTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = modeTabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      setMode(nextIndex, true);
    });
  });

  // Preserve original marketing behavior: mobile, Save-Data and reduced-motion
  // visitors start with the poster; anyone can explicitly opt in to video.
  // Never download the background movie until playback is permitted/requested.
  const video = document.getElementById("hero-video");
  const videoToggle = document.getElementById("video-toggle");
  const network = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const smallScreen = window.matchMedia("(max-width: 800px)");
  let manuallyPaused = false;
  let explicitlyRequested = false;
  let videoInView = false;

  function mayAutoplayVideo() {
    return !reducedMotion.matches && !(network && network.saveData) && !smallScreen.matches;
  }

  function updateVideoLabel() {
    if (!video || !videoToggle) return;

    const playing = !video.paused && !video.ended;
    const icon = videoToggle.querySelector(".font-icon");
    const label = videoToggle.querySelector(".video-toggle-label");

    if (icon) {
      icon.classList.toggle("stratops-ico-pause-1", playing);
      icon.classList.toggle("stratops-ico-next-1", !playing);
    }

    if (label) {
      label.textContent = playing ? "PAUSE MOTION" : "PLAY MOTION";
    }

    videoToggle.setAttribute(
      "aria-label",
      playing ? "Pause background video" : "Play background video"
    );
  }

  function attemptVideoPlay() {
    if (!video || manuallyPaused || document.hidden || !videoInView) return;
    if (!(explicitlyRequested || mayAutoplayVideo())) return;
    if (!video.getAttribute("src") && video.dataset.src) {
      video.src = video.dataset.src;
      video.load();
    }
    try {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => updateVideoLabel()); // Autoplay may be blocked; user can retry.
      }
    } catch (_) {
      updateVideoLabel();
    }
  }

  if (video && videoToggle) {
    // The original page showed its video control before playback, including on mobile.
    // Keep that behavior instead of hiding the button on devices that don't autoplay.
    videoToggle.hidden = false;
    updateVideoLabel();
    video.addEventListener("playing", updateVideoLabel);
    video.addEventListener("pause", updateVideoLabel);
    video.addEventListener("error", () => {
      videoToggle.hidden = true; // Missing/corrupt movie; poster remains visible.
    });
    videoToggle.addEventListener("click", () => {
      if (video.paused) {
        explicitlyRequested = true;
        manuallyPaused = false;
        attemptVideoPlay();
      } else {
        manuallyPaused = true;
        video.pause();
      }
    });
    if ("IntersectionObserver" in window) {
      const videoObserver = new IntersectionObserver((entries) => {
        videoInView = entries.some((entry) => entry.isIntersecting);
        if (videoInView) attemptVideoPlay();
        else video.pause();
      }, { threshold: 0.05 });
      videoObserver.observe(video);
    } else {
      videoInView = true;
      attemptVideoPlay();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) video.pause();
      else attemptVideoPlay();
    });
    const handleSmallScreenChange = () => {
      if (!smallScreen.matches) attemptVideoPlay();
      else if (!explicitlyRequested && video && !video.paused) video.pause();
    };
    if (typeof smallScreen.addEventListener === "function") {
      smallScreen.addEventListener("change", handleSmallScreenChange);
    } else if (typeof smallScreen.addListener === "function") {
      smallScreen.addListener(handleSmallScreenChange);
    }
  }

  function motionChange() {
    if (reducedMotion.matches) {
      parallaxItems.forEach((item) => item.style.removeProperty("--parallax-y"));
      showEverything();
      if (video && !video.paused) video.pause();
      if (videoToggle) updateVideoLabel();
    } else {
      requestScrollRender();
      attemptVideoPlay();
    }
  }
  if (typeof reducedMotion.addEventListener === "function") reducedMotion.addEventListener("change", motionChange);
  else if (typeof reducedMotion.addListener === "function") reducedMotion.addListener(motionChange);
})();
