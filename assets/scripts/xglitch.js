// assets/scripts/xglitch-global.js
// Uses global PIXI and gsap from <script> tags

class GlitchBanner {
    constructor(canvas) {
        const imgLink = canvas.dataset.image;
        if (!imgLink) {
            console.warn("No data-image found for canvas:", canvas);
            return;
        }

        const app = new PIXI.Application({
            view: canvas,
            width: canvas.clientWidth || 600,
            height: canvas.clientHeight || 350,
            transparent: true,
            antialias: true,
        });

        this.app = app;

        const texture = PIXI.Texture.from(imgLink);
        this.img = new PIXI.Sprite(texture);

        if (texture.baseTexture.valid) {
            this.onTextureLoaded();
        } else {
            texture.baseTexture.on("loaded", () => this.onTextureLoaded());
        }
    }

    onTextureLoaded() {
        const app = this.app;
        const img = this.img;
        const tex = img.texture;

        const scale = Math.max(
            app.screen.width / tex.width,
            app.screen.height / tex.height
        );

        img.anchor.set(0.5);
        img.x = app.screen.width / 2;
        img.y = app.screen.height / 2;
        img.scale.set(scale);

        app.stage.addChild(img);

        const rgbSplit = new PIXI.filters.RGBSplitFilter();
        const glitch = new PIXI.filters.GlitchFilter();

        img.filters = [rgbSplit, glitch];

        rgbSplit.red.x = 0;
        rgbSplit.red.y = 0;
        rgbSplit.green.x = 0;
        rgbSplit.green.y = 0;
        rgbSplit.blue.x = 0;
        rgbSplit.blue.y = 0;

        glitch.slices = 0;
        glitch.offset = 20;

        this.anim = this.anim.bind(this);
        this.anim();
    }

    randomIntFromInterval(min, max) {
        return Math.random() * (max - min + 1) + min;
    }

    anim() {
        const rgbSplit = this.img.filters[0];
        const glitch = this.img.filters[1];

        const tl = gsap.timeline({
            delay: this.randomIntFromInterval(0, 3),
            onComplete: this.anim,
        });

        tl.to(rgbSplit.red, {
            duration: 0.2,
            x: this.randomIntFromInterval(-15, 15),
            y: this.randomIntFromInterval(-15, 15),
        });

        tl.to(rgbSplit.red, {
            duration: 0.01,
            x: 0,
            y: 0,
        });

        tl.to(
            rgbSplit.blue,
            {
                duration: 0.2,
                x: this.randomIntFromInterval(-15, 15),
                y: 0,
                onComplete: () => {
                    glitch.slices = 20;
                    glitch.direction = this.randomIntFromInterval(-75, 75);
                },
            },
            "-=0.2"
        );

        tl.to(rgbSplit.blue, {
            duration: 0.1,
            x: this.randomIntFromInterval(-15, 15),
            y: this.randomIntFromInterval(-5, 5),
            onComplete: () => {
                glitch.slices = 12;
                glitch.direction = this.randomIntFromInterval(-75, 75);
            },
        });

        tl.to(rgbSplit.blue, {
            duration: 0.01,
            x: 0,
            y: 0,
            onComplete: () => {
                glitch.slices = 0;
                glitch.direction = 0;
            },
        });

        tl.to(
            rgbSplit.green,
            {
                duration: 0.2,
                x: this.randomIntFromInterval(-15, 15),
                y: 0,
            },
            "-=0.2"
        );

        tl.to(rgbSplit.green, {
            duration: 0.1,
            x: this.randomIntFromInterval(-20, 20),
            y: this.randomIntFromInterval(-15, 15),
        });

        tl.to(rgbSplit.green, {
            duration: 0.01,
            x: 0,
            y: 0,
        });

        tl.timeScale(1.2);
    }
}

// turn a single <img> into an overlaid glitch canvas
function glitchifyImage(img) {
    if (!img || !img.src) return;
    if (img.dataset.glitchApplied === "true") return;
    img.dataset.glitchApplied = "true";

    const setup = () => {
        const parent = img.parentElement;
        if (!parent) return;

        const style = window.getComputedStyle(parent);
        if (style.position === "static") {
            parent.style.position = "relative";
        }

        const canvas = document.createElement("canvas");
        canvas.classList.add("pixi-banner");
        canvas.dataset.image = img.src;

        const width = img.clientWidth || img.naturalWidth || 600;
        const height = img.clientHeight || img.naturalHeight || 350;
        canvas.width = width;
        canvas.height = height;

        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";

        // keep layout but hide original image
        img.style.opacity = "0";

        parent.appendChild(canvas);

        new GlitchBanner(canvas);
    };

    if (img.complete && img.naturalWidth > 0) {
        setup();
    } else {
        img.addEventListener("load", setup, { once: true });
    }
}

// find XSwiper images and apply glitch
function initGlitchForXswiper() {
    // only images inside the swiper
    const swiperImgs = document.querySelectorAll(
        "#xswiper article.xswiper__slide img.xswiper__image"
    );

    swiperImgs.forEach(glitchifyImage);

    // OPTIONAL: any other image you want, just give it class="js-glitch"
    const manualImgs = document.querySelectorAll("img.js-glitch");
    manualImgs.forEach(glitchifyImage);
}

// wait until everything (including images) is loaded
window.addEventListener("load", initGlitchForXswiper);
