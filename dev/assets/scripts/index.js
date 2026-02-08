// assets/scripts/index.js
import "../style.css";

import { initBoot, initContactForm, initBackgroundAudio } from "./essential.js";
import { initXSwiper } from "./xswiper.js";
import { initXFolio } from "./xfolio.js";

initBoot({
    initXSwiper,
    initXFolio,
    initContactForm,
    initBackgroundAudio,
});
