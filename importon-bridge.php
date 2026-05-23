<?php
/**
 * Plugin Name: Importon Bridge
 * Description: Import products into WooCommerce via browser companion + REST API.
 * Version: 0.1.0
 * Author: Nasratul Nayem
 * Author URI: https://codex.nayem.dev
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: importon-bridge
 *
 * Browser-companion-first importer (no scraping UI in admin).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'IMPORTONBRIDGE_VERSION', '0.1.0' );
define( 'IMPORTONBRIDGE_PLUGIN_FILE', __FILE__ );
define( 'IMPORTONBRIDGE_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

require_once IMPORTONBRIDGE_PLUGIN_DIR . 'includes/class-importonbridge-admin.php';
require_once IMPORTONBRIDGE_PLUGIN_DIR . 'includes/class-importonbridge-rest.php';
require_once IMPORTONBRIDGE_PLUGIN_DIR . 'includes/class-importonbridge-frontend.php';
require_once IMPORTONBRIDGE_PLUGIN_DIR . 'includes/class-importonbridge-url-import.php';

final class ImportonBridge_Plugin {
	public static function init(): void {
		register_activation_hook( IMPORTONBRIDGE_PLUGIN_FILE, array( __CLASS__, 'activate' ) );
		add_action( 'plugins_loaded', array( __CLASS__, 'plugins_loaded' ) );
	}

	public static function activate(): void {
		ImportonBridge_Rest::create_usage_table();
	}

	public static function plugins_loaded(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', function () {
				echo '<div class="notice notice-error"><p>' . esc_html__( 'Importon Bridge requires WooCommerce to be installed and active.', 'importon-bridge' ) . '</p></div>';
			} );
			return;
		}

		if ( is_admin() ) {
			ImportonBridge_Admin::init();
			ImportonBridge_Url_Import::init();
		}

		ImportonBridge_Rest::init();
		ImportonBridge_Frontend::init();
	}
}

ImportonBridge_Plugin::init();

add_action( 'before_woocommerce_init', function () {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', IMPORTONBRIDGE_PLUGIN_FILE, true );
	}
} );
