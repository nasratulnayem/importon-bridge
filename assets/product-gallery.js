(function () {
	var d = window.importonbridgeGalleryData || {};
	if ( ! d || ! d.video ) {
		return;
	}

	var selectors = [
		'.woocommerce-product-gallery__wrapper',
		'.wp-block-woocommerce-product-image-gallery',
		'.wc-block-components-product-image'
	];
	var container = null;
	for ( var i = 0; i < selectors.length; i++ ) {
		container = document.querySelector( selectors[ i ] );
		if ( container ) {
			break;
		}
	}
	if ( ! container ) {
		container = document.querySelector( '.summary.entry-summary' );
		if ( ! container || ! container.parentNode ) {
			return;
		}
	}

	var wrap = document.querySelector( '.importonbridge-product-gallery-video-slide' );
	if ( ! wrap ) {
		wrap = document.createElement( 'div' );
		wrap.className = 'woocommerce-product-gallery__image importonbridge-product-gallery-video importonbridge-product-gallery-video-slide';
		wrap.style.marginBottom = '12px';
		var video = document.createElement( 'video' );
		video.setAttribute( 'controls', 'controls' );
		video.setAttribute( 'playsinline', 'playsinline' );
		video.setAttribute( 'preload', 'metadata' );
		video.src = d.video;
		if ( d.poster ) {
			video.poster = d.poster;
		}
		video.style.width = '100%';
		video.style.height = 'auto';
		wrap.appendChild( video );

		if ( container.classList && container.classList.contains( 'summary' ) && container.parentNode ) {
			container.parentNode.insertBefore( wrap, container );
		} else if ( container.firstChild ) {
			container.insertBefore( wrap, container.firstChild );
		} else {
			container.appendChild( wrap );
		}
	}

	var thumbs = document.querySelector( '.flex-control-thumbs' );
	if ( thumbs && ! thumbs.querySelector( '.importonbridge-video-thumb' ) ) {
		var fallbackThumb = '';
		var firstThumb = thumbs.querySelector( 'li img' );
		if ( firstThumb && firstThumb.getAttribute( 'src' ) ) {
			fallbackThumb = firstThumb.getAttribute( 'src' );
		}
		var thumbSrc = d.poster || fallbackThumb;
		if ( ! thumbSrc ) {
			return;
		}

		var slides = container.querySelectorAll( '.woocommerce-product-gallery__image' );
		var idx = -1;
		for ( var j = 0; j < slides.length; j++ ) {
			if ( slides[ j ] === wrap ) {
				idx = j;
				break;
			}
		}

		var li = null;
		var thumbItems = thumbs.querySelectorAll( 'li' );
		if ( idx >= 0 && thumbItems[ idx ] ) {
			li = thumbItems[ idx ];
			var existingImg = li.querySelector( 'img' );
			if ( existingImg && ! existingImg.getAttribute( 'src' ) ) {
				existingImg.src = thumbSrc;
			}
		} else {
			li = document.createElement( 'li' );
			var thumb = document.createElement( 'img' );
			thumb.alt = 'Video thumbnail';
			thumb.src = thumbSrc;
			thumb.style.objectFit = 'cover';
			thumb.style.position = 'relative';
			li.appendChild( thumb );
			thumbs.appendChild( li );
		}
		li.classList.add( 'importonbridge-video-thumb' );

		( function ( li, wrap, slides, idx ) {
			li.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				var gallery = document.querySelector( '.woocommerce-product-gallery' );
				if ( window.jQuery && jQuery.fn && jQuery.fn.flexslider && gallery ) {
					var $gallery = jQuery( gallery );
					var fs = $gallery.data( 'flexslider' );
					if ( fs && idx >= 0 ) {
						fs.flexAnimate( idx );
						return;
					}
				}
				for ( var k = 0; k < slides.length; k++ ) {
					slides[ k ].style.display = ( slides[ k ] === wrap ) ? '' : 'none';
				}
				var vid = wrap.querySelector( 'video' );
				if ( vid && vid.paused ) {
					vid.play().catch( function () {} );
				}
			} );
		} )( li, wrap, slides, idx );
	}
})();
