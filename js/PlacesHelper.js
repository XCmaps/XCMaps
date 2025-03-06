export function changeSwiper() {
    if (typeof window.swiperc !== "undefined") {
        if (window.innerWidth < 576) {
            $(".swiper2").css("height", ""); 
            $(".swiper2").css("width", "320px");
            $(".swiper2").css("padding-left", ""); 
            $(".swiper2").css("padding-top", "30px");
            $(".swiper2 > .swiper-wrapper").css("width", ""); 
            $(".swiper2 > .swiper-wrapper").css("height", "100px");
            window.swiperc.changeDirection('horizontal', true);
        }
        else {
            if (window.innerWidth < 840) {
                $(".swiper2").css("width", ""); 
                $(".swiper2").css("height", "320px");
            }
            else {
                $(".swiper2").css("width", ""); 
                $(".swiper2").css("height", "460px");
            }
            $(".swiper2").css("padding-top", ""); 
            $(".swiper2").css("padding-left", "30px");
            $(".swiper2 > .swiper-wrapper").css("height", ""); 
            $(".swiper2 > .swiper-wrapper").css("width", "100px");
            window.swiperc.changeDirection('vertical', true);
        }
    }
}

export function initSwiper(idImg) {
    const swiperLoop3 = (idImg < 4) ? false : true;
    const swiperLoop4 = (idImg < 5) ? false : true;

    window.swiperv = new Swiper('.swiper1', {
        autoHeight: true,
        direction: 'horizontal',
        allowTouchMove: false,
        mousewheel: false,
        slidesPerView: 1,
        loop: false,
    });

    window.swiperc = new Swiper('.swiper2', {
        direction: 'vertical',
        allowTouchMove: true,
        mousewheel: true,
        slidesPerView: 3,
        spaceBetween: 10,
        loop: swiperLoop3,
        breakpoints: {
            840: {
                slidesPerView: 4,
                loop: swiperLoop4
            }
        },
        scrollbar: {
            el: '.swiper-scrollbar',
            hide: false,
            draggable: true,
        },
        on: {
            click: function() {
                const iR = (this.clickedSlide.firstChild.id).substring(3) - 1;
                window.swiperv.slideTo(iR, 1);
            },
            transitionEnd: function () {
                const iR = this.realIndex;
                window.swiperv.slideTo(iR, 1);
            }
        }
    });

    changeSwiper();
}

export function getAngleRange(direction) {
    const dirToAngle = {
        "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
        "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
        "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
        "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5
    };

    const angleRanges = [];
    const parts = direction.split(',').map(part => part.trim());

    parts.forEach(part => {
        const range = part.split('-').map(dir => dir.trim());
        if (range.length === 1) {
            const angle = dirToAngle[range[0]];
            if (angle !== undefined) {
                angleRanges.push([angle - 22.5, angle + 22.5]);
            }
        } else if (range.length === 2) {
            let start = dirToAngle[range[0]];
            let end = dirToAngle[range[1]];
            if (start !== undefined && end !== undefined) {
                if (end < start) [start, end] = [end, start];
                if (end - start > 180) [start, end] = [end, start];
                angleRanges.push([start, end]);
            }
        }
    });

    return angleRanges;
}

export async function loadPlaceDetails(layer, placeId) {
    try {
        const response = await fetch(`/api/place/${placeId}`);
        const data = await response.json();

        if (data.error) {
            console.error("Error fetching place details:", data.error);
            return;
        }

        const regex1 = /<center><b><a href="http:\/\/www\.paraglidingearth\.com\/index\.php\?site=\d+">More information on ParaglidingEarth<\/a><\/b><\/center>\n?/g;
        const regex2 = /<br>\n<b>Take off : <\/b><br>\n?/g;

        const description = (data.properties.description || "")
            .replace(regex1, "")
            .replace(regex2, "")
            .trim();

        let popupContent = `<b>Name: ${data.properties.name}</b><br>
                          <b>Type:</b> ${data.properties.type}<br>
                          <b>Direction:</b> ${data.properties.direction}<br><br>
                          <b>Description:</b> ${description}`;

        popupContent += `<style>
            .swiper-container { max-height: 460px !important; height: 460px !important; }
            .swiper, .swiper1, .swiper2 { max-height: 460px !important; }
            .swiper-wrapper { max-height: 460px !important; }
            .swiper-slide { max-height: 460px !important; display: flex !important; }
            .swiper-slide img { max-height: 100% !important; width: auto !important; }
            .leaflet-popup-content { max-height: 780px !important; overflow-y: auto; }
            .swiper-clear { clear: both; margin-bottom: 1px; }
        </style>`;

        layer.setPopupContent(popupContent);

        setTimeout(() => {
            const firstImg = document.querySelector(".swiper1 .swiper-slide img");
            if (firstImg) {
                const idImg = parseInt(firstImg.id.replace(/\D/g, ""), 10) || 1;
                initSwiper(idImg);
            }
        }, 300);
    } catch (error) {
        console.error("Error fetching place details:", error);
    }
}