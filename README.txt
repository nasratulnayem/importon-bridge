=== Importon Bridge ===
Contributors: nasratulnayem
Tags: woocommerce, import, product importer, browser companion, alibaba
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Importon Bridge connects a browser companion to WooCommerce so you can import products from product pages into WordPress with one workflow.

== Description ==

Importon Bridge provides a structured import workflow for WooCommerce stores:

* a WordPress admin screen for setup and monitoring
* a browser companion for capturing product data in the browser
* authenticated REST endpoints for product creation and updates
* optional AI rewriting for product titles and descriptions
* a batch URL import queue with run history and failed-item logs

The plugin supports simple and variable WooCommerce products, including title, description, images, attributes, variations, and pricing.

AI rewriting is optional. When enabled, the plugin can send product copy to OpenAI or Google Gemini using administrator-provided API keys.

Alibaba is referenced only to describe supported product pages. Importon Bridge is not affiliated with Alibaba Group.

== Installation ==

1. Upload the `importon-bridge` folder to `/wp-content/plugins/`.
2. Activate the plugin through the **Plugins** menu in WordPress.
3. Ensure WooCommerce is installed and active.
4. Open **Importon Bridge** in the WordPress admin.
5. Download the browser companion from the settings page and load it in Chrome.
6. Create a WordPress Application Password in your user profile and paste it into the connection panel together with your site URL and username.

== Frequently Asked Questions ==

= Does this require the official Alibaba API? =

No. The browser companion reads product data from the browser and sends it to WordPress through the plugin's REST API.

= Is AI rewriting required? =

No. AI rewriting is optional and only runs when you enable it and configure API keys.

= Which AI providers are supported? =

OpenAI and Google Gemini.

= Where are import logs stored? =

Import run logs are stored in the WordPress uploads directory and can be reviewed from the Importon Bridge admin screens.

== Screenshots ==

1. Settings and connection screen.
2. Batch URL import dashboard.
3. AI rewrite settings and usage panels.

== Changelog ==

= 0.1.0 =
* Initial release.
* browser companion import flow via authenticated REST API.
* WooCommerce product creation and updates.
* Optional AI rewriting.
* Batch URL import queue with run logs.

== Upgrade Notice ==

= 0.1.0 =
Initial release.
