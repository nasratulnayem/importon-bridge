<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImportonBridge_Admin {
	private static $hook_suffix = '';
	private static $legacy_hook_suffix = '';
	private static $url_import_hook_suffix = '';
	private static $rewriter_hook_suffix = '';
	private static $usage_hook_suffix = '';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'redirect_old_slugs' ), 0 );
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin_assets' ) );
		add_action( 'admin_notices', array( __CLASS__, 'maybe_show_app_passwords_notice' ) );
		add_action( 'admin_post_importonbridge_enable_app_passwords', array( __CLASS__, 'handle_enable_app_passwords' ) );
		add_action( 'wp_ajax_importonbridge_auto_apppass', array( __CLASS__, 'ajax_auto_apppass' ) );
	}

	public static function redirect_old_slugs(): void {
		$old_map = array(
			'atw-url-import' => 'importonbridge-url-import',
			'atw-rewriter'   => 'importonbridge-rewriter',
			'atw-usage'      => 'importonbridge-usage',
		);
		$page = isset( $_GET['page'] ) ? sanitize_key( $_GET['page'] ) : '';
		if ( $page !== '' && isset( $old_map[ $page ] ) ) {
			wp_safe_redirect( add_query_arg( 'page', $old_map[ $page ], admin_url( 'admin.php' ) ) );
			exit;
		}
	}

	public static function maybe_show_app_passwords_notice(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( ! function_exists( 'get_main_network_id' ) || ! function_exists( 'get_network_option' ) ) {
			return;
		}
		$in_use = (bool) get_network_option( get_main_network_id(), 'importonbridge_using_application_passwords' );
		if ( $in_use ) {
			return;
		}
		$action_url = wp_nonce_url(
			admin_url( 'admin-post.php?action=importonbridge_enable_app_passwords' ),
			'importonbridge_enable_app_passwords'
		);
		?>
		<div class="notice notice-warning">
			<p>
				<strong><?php esc_html_e( 'Importon Bridge:', 'importon-bridge' ); ?></strong>
				<?php esc_html_e( 'Application Passwords are not yet enabled on this site. The Chrome extension will not be able to authenticate until they are enabled.', 'importon-bridge' ); ?>
				<a href="<?php echo esc_url( $action_url ); ?>" class="button button-secondary" style="margin-left:8px;">
					<?php esc_html_e( 'Enable Application Passwords', 'importon-bridge' ); ?>
				</a>
			</p>
		</div>
		<?php
	}

	public static function handle_enable_app_passwords(): void {
		check_admin_referer( 'importonbridge_enable_app_passwords' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'importon-bridge' ) );
		}
		if ( function_exists( 'get_main_network_id' ) && function_exists( 'update_network_option' ) ) {
			update_network_option( get_main_network_id(), 'importonbridge_using_application_passwords', 1 );
		}
		wp_safe_redirect( admin_url( 'admin.php?page=importon-bridge&importonbridge_app_pw_enabled=1' ) );
		exit;
	}

	public static function admin_menu(): void {
		$cap = class_exists( 'WooCommerce' ) ? 'manage_woocommerce' : 'manage_options';

		self::$hook_suffix = (string) add_menu_page(
			'Importon Bridge',
			'Importon Bridge',
			$cap,
			'importon-bridge',
			array( __CLASS__, 'render_page' ),
			'dashicons-store',
			56
		);

		// Settings submenu (same as parent page)
		add_submenu_page(
			'importon-bridge',
			__( 'Connect', 'importon-bridge' ),
			__( 'Connect', 'importon-bridge' ),
			$cap,
			'importon-bridge',
			array( __CLASS__, 'render_page' )
		);

		self::$url_import_hook_suffix = (string) add_submenu_page(
			'importon-bridge',
			__( 'URL Import', 'importon-bridge' ),
			__( 'URL Import', 'importon-bridge' ),
			$cap,
			'importonbridge-url-import',
			array( __CLASS__, 'render_url_import_page' )
		);

		self::$legacy_hook_suffix = (string) add_submenu_page(
			null,
			__( 'Alibaba Import', 'importon-bridge' ),
			__( 'Alibaba Import', 'importon-bridge' ),
			$cap,
			'importonbridge-alibaba-import',
			array( __CLASS__, 'render_legacy_redirect' )
		);

		self::$rewriter_hook_suffix = (string) add_submenu_page(
			'importon-bridge',
			__( 'Rewriter', 'importon-bridge' ),
			__( 'Rewriter', 'importon-bridge' ),
			$cap,
			'importonbridge-rewriter',
			array( __CLASS__, 'render_rewriter_page' )
		);

		self::$usage_hook_suffix = (string) add_submenu_page(
			'importon-bridge',
			__( 'Usage', 'importon-bridge' ),
			__( 'Usage', 'importon-bridge' ),
			$cap,
			'importonbridge-usage',
			array( __CLASS__, 'render_usage_page' )
		);
	}

	public static function enqueue_admin_assets( string $hook_suffix ): void {
		if ( ! in_array( $hook_suffix, array( self::$hook_suffix, self::$legacy_hook_suffix, self::$url_import_hook_suffix, self::$rewriter_hook_suffix, self::$usage_hook_suffix ), true ) ) {
			return;
		}

		wp_register_style( 'importonbridge_admin', false, array(), IMPORTONBRIDGE_VERSION );
		wp_enqueue_style( 'importonbridge_admin' );
		wp_add_inline_style( 'importonbridge_admin', self::get_common_admin_css() );

		if ( $hook_suffix === self::$url_import_hook_suffix ) {
			wp_enqueue_script(
				'importonbridge_url_import_admin',
				plugin_dir_url( IMPORTONBRIDGE_PLUGIN_FILE ) . 'assets/url-import-admin.js',
				array(),
				IMPORTONBRIDGE_VERSION,
				true
			);

			$user = wp_get_current_user();
			wp_localize_script(
				'importonbridge_url_import_admin',
				'importonbridgeUrlImportData',
				array(
					'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
					'nonce'        => ImportonBridge_Url_Import::get_ajax_nonce(),
					'restNonce'    => wp_create_nonce( 'wp_rest' ),
					'connectUrl'   => rest_url( 'importonbridge/v1/connect' ),
					'categories'   => ImportonBridge_Url_Import::get_categories(),
					'latestRun'    => ImportonBridge_Url_Import::get_latest_run(),
					'recentRuns'   => ImportonBridge_Url_Import::get_recent_runs( 8, false ),
					'siteBaseUrl'  => home_url( '/' ),
					'currentUser'  => $user instanceof WP_User ? (string) $user->user_login : '',
					'settingsUrl'  => admin_url( 'admin.php?page=importon-bridge' ),
					'quota'        => array( 'allowed' => true, 'remaining' => 999, 'is_pro' => true ),
					'quotaLimit'   => 999,
				)
			);

			wp_add_inline_script( 'importonbridge_url_import_admin', self::get_quota_js() );
		}

		if ( in_array( $hook_suffix, array( self::$hook_suffix, self::$url_import_hook_suffix ), true ) ) {
			wp_enqueue_script(
				'importonbridge_auto_connect',
				plugin_dir_url( IMPORTONBRIDGE_PLUGIN_FILE ) . 'assets/auto-connect.js',
				array(),
				IMPORTONBRIDGE_VERSION,
				true
			);

			$user = wp_get_current_user();
			wp_localize_script(
				'importonbridge_auto_connect',
				'importonbridgeAutoConnectData',
				array(
					'ajaxUrl'     => admin_url( 'admin-ajax.php' ),
					'siteBaseUrl' => home_url( '/' ),
					'currentUser' => $user instanceof WP_User ? (string) $user->user_login : '',
				)
			);
		}
	}

	public static function render_legacy_redirect(): void {
		self::assert_access();

		wp_safe_redirect( admin_url( 'admin.php?page=importon-bridge' ) );
		exit;
	}

	public static function render_page(): void {
		self::assert_access();

		$state        = self::handle_settings_postback();
		$site_url     = home_url( '/' );
		$current_user = wp_get_current_user();

		$stored_creds = array();
		if ( $current_user instanceof WP_User && $current_user->ID > 0 ) {
			$stored_creds = (array) get_user_meta( $current_user->ID, 'importonbridge_creds', true );
		}
		$has_stored = ! empty( $stored_creds['password'] ) && ! empty( $stored_creds['username'] ) && ! empty( $stored_creds['base_url'] );
		?>
		<div class="wrap importonbridge-wrap importonbridge-shell importonbridge-page">
		<meta name="importonbridge-url-import-bridge" content="1">
			<div class="importonbridge-connect-top">
				<a href="https://github.com/nasratulnayem/importon-bridge/releases/download/v0.1.0/importon-bridge-extension.zip" target="_blank" rel="noopener noreferrer" class="importonbridge-download-link" id="importonbridge-download-link">Download Extension</a>
			</div>

			<div class="importonbridge-connect-hero" id="importonbridge-download-hero">
				<div class="importonbridge-connect-hero-icon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
				</div>
				<h2>Download the Extension</h2>
				<p>Get the Chrome extension to start importing products from Alibaba.</p>
				<a href="https://github.com/nasratulnayem/importon-bridge/releases/download/v0.1.0/importon-bridge-extension.zip" target="_blank" rel="noopener noreferrer" class="importonbridge-btn-primary" id="importonbridge-download-btn">Download Extension</a>
			</div>

			<div class="importonbridge-connect-main" id="importonbridge-main-section" style="display:none;">
				<div class="importonbridge-info-grid" style="margin-bottom:16px;">
					<div class="importonbridge-info-item">
						<span class="importonbridge-info-label">WordPress Base URL</span>
						<code><?php echo esc_html( rtrim( $site_url, '/' ) ); ?></code>
					</div>
					<div class="importonbridge-info-item">
						<span class="importonbridge-info-label">Username</span>
						<code><?php echo esc_html( $current_user->user_login ); ?></code>
					</div>
				</div>

				<div class="importonbridge-card importonbridge-card--cta" style="margin-bottom:16px;">
					<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
						<div>
							<div style="font-weight:600;font-size:14px;margin-bottom:4px;">Connect to Extension</div>
							<div style="color:var(--text-light);font-size:13px;">Make sure the extension is installed and loaded on this page.</div>
						</div>
						<button type="button" class="importonbridge-btn" id="importonbridge-connect-btn">Connect to Extension</button>
					</div>
					<div id="importonbridge-connect-status" style="margin-top:10px;font-size:13px;font-weight:600;min-height:20px;"></div>
				</div>

				<div id="importonbridge-new-apppass-data" style="display:none;"<?php if ( $has_stored ) : ?> data-password="<?php echo esc_attr( $stored_creds['password'] ); ?>" data-username="<?php echo esc_attr( $stored_creds['username'] ); ?>" data-baseurl="<?php echo esc_attr( $stored_creds['base_url'] ); ?>"<?php endif; ?>></div>
			</div>
			</div>
			<?php
	}

	public static function render_rewriter_page(): void {
		self::assert_access();

		$state = self::handle_settings_postback();
		?>
		<div class="importonbridge-wrap importonbridge-shell importonbridge-page">
			<div class="importonbridge-hero">
				<div class="importonbridge-hero-copy">
					<h1>AI Rewriter</h1>
					<p>Configure AI providers, models, and rewrite rules for imported products.</p>
				</div>
			</div>

			<?php if ( $state['ai_notice'] !== '' ) : ?>
				<div class="importonbridge-alert importonbridge-alert--success" style="margin-bottom:16px;"><?php echo esc_html( $state['ai_notice'] ); ?></div>
			<?php endif; ?>
			<?php if ( $state['ai_error'] !== '' ) : ?>
				<div class="importonbridge-alert importonbridge-alert--danger" style="margin-bottom:16px;"><?php echo esc_html( $state['ai_error'] ); ?></div>
			<?php endif; ?>

			<form method="post" class="importonbridge-form-stack">
				<?php wp_nonce_field( 'importonbridge_save_ai_settings_action', 'importonbridge_save_ai_settings_nonce' ); ?>

				<div class="importonbridge-ai-summary" style="margin-bottom:20px;">
					<div class="importonbridge-ai-summary-item">
						<span class="importonbridge-ai-summary-label">Rewrite</span>
						<strong class="importonbridge-ai-summary-value"><?php echo $state['ai_enabled'] ? esc_html__( 'Enabled', 'importon-bridge' ) : esc_html__( 'Disabled', 'importon-bridge' ); ?></strong>
					</div>
					<div class="importonbridge-ai-summary-item">
						<span class="importonbridge-ai-summary-label">Provider</span>
						<strong class="importonbridge-ai-summary-value"><?php echo 'gemini_first' === $state['ai_provider_order'] ? esc_html__( 'Gemini → OpenAI', 'importon-bridge' ) : esc_html__( 'OpenAI → Gemini', 'importon-bridge' ); ?></strong>
					</div>
					<div class="importonbridge-ai-summary-item">
						<span class="importonbridge-ai-summary-label">OpenAI</span>
						<strong class="importonbridge-ai-summary-value"><?php echo $state['ai_openai_key_saved'] ? esc_html__( 'Ready', 'importon-bridge' ) : esc_html__( 'Not Set', 'importon-bridge' ); ?></strong>
					</div>
					<div class="importonbridge-ai-summary-item">
						<span class="importonbridge-ai-summary-label">Gemini</span>
						<strong class="importonbridge-ai-summary-value"><?php echo $state['ai_gemini_key_saved'] ? esc_html__( 'Ready', 'importon-bridge' ) : esc_html__( 'Not Set', 'importon-bridge' ); ?></strong>
					</div>
				</div>

				<details class="importonbridge-accordion" style="margin-bottom:12px;">
					<summary>
						<div class="importonbridge-accordion-copy">
							<span class="importonbridge-accordion-title">General</span>
							<span class="importonbridge-accordion-meta">Enable rewriting and choose provider order.</span>
						</div>
					</summary>
					<div class="importonbridge-accordion-body">
						<div class="importonbridge-kv">
							<div class="importonbridge-k">Enable AI Rewrite</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_ai_enabled" value="1" <?php checked( $state['ai_enabled'] ); ?>>
									<span>Allow AI rewrite during import when a valid provider is configured</span>
								</label>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Rewrite Title</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_rewrite_title" value="1" <?php checked( $state['ai_rewrite_title'] ); ?>>
									<span>Rewrite imported product title with AI</span>
								</label>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Rewrite Description</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_rewrite_description" value="1" <?php checked( $state['ai_rewrite_description'] ); ?>>
									<span>Rewrite imported short and long descriptions with AI</span>
								</label>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Provider Order</div>
							<div class="importonbridge-v">
								<select name="importonbridge_ai_provider_order">
									<option value="openai_first" <?php selected( $state['ai_provider_order'], 'openai_first' ); ?>>OpenAI first, Gemini fallback</option>
									<option value="gemini_first" <?php selected( $state['ai_provider_order'], 'gemini_first' ); ?>>Gemini first, OpenAI fallback</option>
								</select>
								<div class="importonbridge-field-help">If both keys are available, URL Import tries the first provider and falls back automatically if it fails.</div>
							</div>
						</div>
					</div>
				</details>

				<details class="importonbridge-accordion" style="margin-bottom:12px;">
					<summary>
						<div class="importonbridge-accordion-copy">
							<span class="importonbridge-accordion-title">OpenAI</span>
							<span class="importonbridge-accordion-meta"><?php echo $state['ai_openai_key_saved'] ? 'Key saved' : 'Add key and model'; ?> · <?php echo esc_html( $state['ai_openai_model'] ); ?></span>
						</div>
					</summary>
					<div class="importonbridge-accordion-body">
						<div class="importonbridge-kv">
							<div class="importonbridge-k">API Key</div>
							<div class="importonbridge-v importonbridge-inline-control">
								<input type="password" name="importonbridge_ai_openai_api_key" placeholder="<?php echo $state['ai_openai_key_saved'] ? 'OpenAI key saved - leave blank to keep existing' : 'sk-proj-...'; ?>" autocomplete="new-password" style="flex:1;min-width:200px;">
								<?php if ( $state['ai_openai_key_saved'] ) : ?>
									<span class="importonbridge-inline-badge importonbridge-inline-badge--success">&#10003; Key saved</span>
								<?php endif; ?>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Model</div>
							<div class="importonbridge-v">
								<?php
								$openai_models = array(
									'gpt-4o-mini'    => 'gpt-4o-mini (cheapest, recommended)',
									'gpt-4.1-nano'   => 'gpt-4.1-nano (cheapest 4.1)',
									'gpt-4.1'        => 'gpt-4.1',
									'gpt-4.1-mini'   => 'gpt-4.1-mini',
									'gpt-4o'         => 'gpt-4o',
									'gpt-4o-mini-2025-01-20' => 'gpt-4o-mini-2025-01-20',
								);
								?>
								<select name="importonbridge_ai_openai_model">
									<?php foreach ( $openai_models as $model_id => $model_label ) : ?>
										<option value="<?php echo esc_attr( $model_id ); ?>" <?php selected( $state['ai_openai_model'], $model_id ); ?>><?php echo esc_html( $model_label ); ?></option>
									<?php endforeach; ?>
								</select>
							</div>
						</div>
					</div>
				</details>

				<details class="importonbridge-accordion" style="margin-bottom:12px;">
					<summary>
						<div class="importonbridge-accordion-copy">
							<span class="importonbridge-accordion-title">Gemini</span>
							<span class="importonbridge-accordion-meta"><?php echo $state['ai_gemini_key_saved'] ? 'Key saved' : 'Add key and model'; ?> · <?php echo esc_html( $state['ai_gemini_model'] ); ?></span>
						</div>
					</summary>
					<div class="importonbridge-accordion-body">
						<div class="importonbridge-kv">
							<div class="importonbridge-k">API Key</div>
							<div class="importonbridge-v importonbridge-inline-control">
								<input type="password" name="importonbridge_ai_gemini_api_key" placeholder="<?php echo $state['ai_gemini_key_saved'] ? 'Gemini key saved - leave blank to keep existing' : 'AIza...'; ?>" autocomplete="new-password" style="flex:1;min-width:200px;">
								<?php if ( $state['ai_gemini_key_saved'] ) : ?>
									<span class="importonbridge-inline-badge importonbridge-inline-badge--success">&#10003; Key saved</span>
								<?php endif; ?>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Model</div>
							<div class="importonbridge-v">
								<?php
								$gemini_models = array(
									'gemini-2.0-flash-exp'        => 'gemini-2.0-flash-exp (recommended)',
									'gemini-2.5-flash-preview-05-20' => 'gemini-2.5-flash-preview-05-20',
									'gemini-2.5-flash'            => 'gemini-2.5-flash (latest stable)',
									'gemini-2.5-pro-preview-05-20'  => 'gemini-2.5-pro-preview-05-20',
									'gemini-1.5-pro'              => 'gemini-1.5-pro',
									'gemini-1.5-flash'            => 'gemini-1.5-flash',
								);
								?>
								<select name="importonbridge_ai_gemini_model">
									<?php foreach ( $gemini_models as $model_id => $model_label ) : ?>
										<option value="<?php echo esc_attr( $model_id ); ?>" <?php selected( $state['ai_gemini_model'], $model_id ); ?>><?php echo esc_html( $model_label ); ?></option>
									<?php endforeach; ?>
								</select>
							</div>
						</div>
					</div>
				</details>

				<details class="importonbridge-accordion" style="margin-bottom:12px;">
					<summary>
						<div class="importonbridge-accordion-copy">
							<span class="importonbridge-accordion-title">Content Rules</span>
							<span class="importonbridge-accordion-meta">Keywords and CTA defaults for rewritten content.</span>
						</div>
					</summary>
					<div class="importonbridge-accordion-body">
						<div class="importonbridge-kv">
							<div class="importonbridge-k">Global Keywords</div>
							<div class="importonbridge-v">
								<input type="text" name="importonbridge_global_keywords" value="<?php echo esc_attr( $state['ai_global_keywords'] ); ?>" placeholder="wholesale, bulk, factory direct">
								<div class="importonbridge-field-help">Comma-separated list of keywords to inject into all rewritten content.</div>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Add Keywords</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_add_keywords" value="1" <?php checked( $state['ai_add_keywords'] ); ?>>
									<span>Prepend keywords to product description</span>
								</label>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">CTA Text</div>
							<div class="importonbridge-v">
								<input type="text" name="importonbridge_cta_text" value="<?php echo esc_attr( $state['ai_cta_text'] ); ?>" placeholder="Call us: +1-234-567-8900">
								<div class="importonbridge-field-help">Call-to-action text appended to rewritten descriptions.</div>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Add CTA</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_add_cta" value="1" <?php checked( $state['ai_add_cta'] ); ?>>
									<span>Append CTA to product description</span>
								</label>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Title Prompt Instructions</div>
							<div class="importonbridge-v">
								<textarea name="importonbridge_title_prompt_instructions" rows="3" placeholder="Extra instructions for AI title output" style="width:100%;"><?php echo esc_textarea( $state['ai_title_prompt_instructions'] ); ?></textarea>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Description Prompt Instructions</div>
							<div class="importonbridge-v">
								<textarea name="importonbridge_description_prompt_instructions" rows="5" placeholder="Extra instructions for AI description output" style="width:100%;"><?php echo esc_textarea( $state['ai_description_prompt_instructions'] ); ?></textarea>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Tag Prompt Instructions</div>
							<div class="importonbridge-v">
								<textarea name="importonbridge_tag_prompt_instructions" rows="4" placeholder="Extra instructions for AI tags output" style="width:100%;"><?php echo esc_textarea( $state['ai_tag_prompt_instructions'] ); ?></textarea>
								<div class="importonbridge-field-help">Used only when Auto Write Tags is enabled and AI returns tags.</div>
							</div>
						</div>
					</div>
				</details>

				<details class="importonbridge-accordion" style="margin-bottom:20px;">
					<summary>
						<div class="importonbridge-accordion-copy">
							<span class="importonbridge-accordion-title">Import Behavior</span>
							<span class="importonbridge-accordion-meta">Control automatic tags and generated SKU format.</span>
						</div>
					</summary>
					<div class="importonbridge-accordion-body">
						<div class="importonbridge-kv">
							<div class="importonbridge-k">Auto Write Tags</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_auto_tags" value="1" <?php checked( $state['ai_auto_tags'] ); ?>>
									<span>Write product tags automatically during import</span>
								</label>
								<div class="importonbridge-field-help">When disabled, the importer leaves product tags untouched.</div>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">Auto SKU Format</div>
							<div class="importonbridge-v">
								<label class="importonbridge-toggle">
									<input type="checkbox" name="importonbridge_auto_sku_format" value="1" <?php checked( $state['ai_auto_sku_format'] ); ?>>
									<span>Generate formatted SKU automatically for imported products</span>
								</label>
								<div class="importonbridge-field-help">When disabled, imported SKU stays manual. Existing SKU is preserved and new products keep the incoming SKU if provided.</div>
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">SKU Prefix</div>
							<div class="importonbridge-v">
								<input type="text" name="importonbridge_sku_prefix" value="<?php echo esc_attr( $state['ai_sku_prefix'] ); ?>" placeholder="F" maxlength="8" style="max-width:120px;">
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">SKU Middle</div>
							<div class="importonbridge-v">
								<input type="text" name="importonbridge_sku_middle_prefix" value="<?php echo esc_attr( $state['ai_sku_middle_prefix'] ); ?>" placeholder="G" maxlength="8" style="max-width:120px;">
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">SKU Suffix</div>
							<div class="importonbridge-v">
								<input type="text" name="importonbridge_sku_suffix" value="<?php echo esc_attr( $state['ai_sku_suffix'] ); ?>" placeholder="K" maxlength="8" style="max-width:120px;">
							</div>
						</div>

						<div class="importonbridge-kv">
							<div class="importonbridge-k">SKU Number Length</div>
							<div class="importonbridge-v">
								<input type="number" name="importonbridge_sku_number_length" value="<?php echo esc_attr( (string) $state['ai_sku_number_length'] ); ?>" min="1" max="8" style="max-width:100px;">
								<div class="importonbridge-field-help">Example format: <?php echo esc_html( $state['ai_sku_prefix'] . '0' . $state['ai_sku_middle_prefix'] . str_repeat( '0', max( 1, (int) $state['ai_sku_number_length'] ) ) . $state['ai_sku_suffix'] ); ?></div>
							</div>
						</div>
					</div>
				</details>

				<div class="importonbridge-actions">
					<div class="importonbridge-btn-row">
						<button type="submit" class="importonbridge-btn" name="importonbridge_save_ai_settings" value="1">Save Settings</button>
						<button type="submit" class="importonbridge-ghost-btn" name="importonbridge_test_openai_api" value="1">Test OpenAI</button>
						<button type="submit" class="importonbridge-ghost-btn" name="importonbridge_test_gemini_api" value="1">Test Gemini</button>
					</div>
					<div class="importonbridge-field-help">The test buttons use the same key and model fields shown above. If you typed a new key but did not save yet, the test still uses that current value for this request.</div>
				</div>
			</form>
		</div>
		<?php
	}

	public static function render_url_import_page(): void {
		self::assert_access();

		$latest_run = ImportonBridge_Url_Import::get_latest_run();
		?>
		<div class="importonbridge-wrap importonbridge-shell importonbridge-page">
			<meta name="importonbridge-url-import-bridge" content="1">

			<div class="importonbridge-hero importonbridge-hero--import">
				<div class="importonbridge-hero-copy">
					<h1>Batch Import from Alibaba</h1>
					<p>Queue product-detail URLs, assign a WooCommerce category once, and let the extension run the same import flow with better visibility and retry support.</p>
				</div>
				<div class="importonbridge-hero-side">
					<div class="importonbridge-hero-actions">
						<a class="importonbridge-ghost-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=importon-bridge' ) ); ?>">Settings</a>
					</div>
				</div>
			</div>

			<?php
			$quota_init  = array( 'allowed' => true, 'remaining' => 999, 'is_pro' => true );
			$q_is_pro    = ! empty( $quota_init['is_pro'] );
			$q_remaining = $q_is_pro ? -1 : (int) $quota_init['remaining'];
			$q_limit     = 999;
			$q_blocked   = ! $quota_init['allowed'];
			$q_pct       = ( ! $q_is_pro && $q_limit > 0 ) ? round( ( ( $q_limit - max( 0, $q_remaining ) ) / $q_limit ) * 100 ) : 0;
			?>

			<div class="importonbridge-grid importonbridge-grid--import">
				<div class="importonbridge-card importonbridge-card--section importonbridge-card--highlight">
					<div class="importonbridge-card-head">
						<div>
							<h2>Import Queue</h2>
							<p>Paste one product-detail URL per line. Duplicate URLs are removed before the run starts.</p>
						</div>
					</div>
					<div class="importonbridge-field">
						<label for="importonbridge-url-import-urls">Product URLs</label>
						<textarea id="importonbridge-url-import-urls" rows="12" placeholder="https://www.alibaba.com/product-detail/demo-product-name_160000000001.html&#10;https://chinaheadwearfactory.com/product/custom-snapback-hat/"></textarea>
						<div class="importonbridge-field-help">One product URL per line. Supports Alibaba and any product page with schema markup.</div>
					</div>

					<div class="importonbridge-form-inline">
						<div class="importonbridge-field">
							<label for="importonbridge-url-import-category">WooCommerce category</label>
							<select id="importonbridge-url-import-category"></select>
						</div>
						<div class="importonbridge-field importonbridge-field-actions">
							<label>&nbsp;</label>
							<div class="importonbridge-btn-row">
								<button type="button" class="importonbridge-btn" id="importonbridge-url-import-start" formnovalidate>Import</button>
								<button type="button" class="importonbridge-ghost-btn" id="importonbridge-url-import-retry" formnovalidate>Retry Failed</button>
							</div>
						</div>
					</div>
				</div>

				<div class="importonbridge-card importonbridge-card--section">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
						<span style="font-size:13px;font-weight:600;color:#475569;">Latest Failed Log</span>
						<a id="importonbridge-url-import-log-link" href="<?php echo ! empty( $latest_run['log_url'] ) ? esc_url( $latest_run['log_url'] ) : '#'; ?>" target="_blank" rel="noopener" style="font-size:12px;color:#2563eb;text-decoration:none;">View Log →</a>
					</div>

					<div class="importonbridge-card-head importonbridge-card-head--compact" style="margin-top:8px;margin-bottom:12px;">
						<div>
							<h2>Live Progress</h2>
							<p style="font-size:12px;color:#64748b;">Real-time import progress</p>
						</div>
					</div>

					<div class="importonbridge-run-stats-grid">
						<div class="importonbridge-stat-box importonbridge-stat-box--status">
							<div class="importonbridge-stat-label">Status</div>
							<div style="font-size:13px;font-weight:600;color:#64748b;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;" id="importonbridge-run-status"><span style="width:8px;height:8px;background:#94a3b8;border-radius:50%;display:inline-block;flex-shrink:0;"></span>&nbsp;Ready</div>
						</div>
						<div class="importonbridge-stat-box">
							<div class="importonbridge-stat-label">Total</div>
							<div class="importonbridge-stat-value" id="importonbridge-run-total" style="font-size:22px;">0</div>
						</div>
						<div class="importonbridge-stat-box">
							<div class="importonbridge-stat-label">Processed</div>
							<div class="importonbridge-stat-value" id="importonbridge-run-processed" style="font-size:22px;">0</div>
						</div>
						<div class="importonbridge-stat-box">
							<div class="importonbridge-stat-label">Success</div>
							<div class="importonbridge-stat-value" id="importonbridge-run-success" style="font-size:22px;">0</div>
						</div>
						<div class="importonbridge-stat-box">
							<div class="importonbridge-stat-label">Failed</div>
							<div class="importonbridge-stat-value" id="importonbridge-run-failed" style="font-size:22px;">0</div>
						</div>
					</div>

					<div style="margin-bottom:8px;">
						<div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:6px;">
							<span>Progress</span>
							<span id="importonbridge-run-processed-label">0%</span>
						</div>
						<div style="width:100%;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
							<div class="importonbridge-progress-bar" id="importonbridge-run-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg, #2563eb 0%, #3b82f6 100%);border-radius:4px;transition:width 0.3s ease;"></div>
						</div>
					</div>

					<p id="importonbridge-run-message" style="font-size:12px;color:#64748b;margin-top:12px;text-align:center;font-style:italic;">No run started yet. Add URLs and click Import to begin.</p>
				</div>
			</div>

			<div class="importonbridge-card importonbridge-card--section importonbridge-card--recent">
				<div class="importonbridge-card-head">
					<div>
						<h2>Recent Runs</h2>
						<p style="font-size:12px;color:#64748b;margin-top:4px;">Track your import history and results</p>
					</div>
					<button type="button" class="importonbridge-ghost-btn" id="importonbridge-url-import-clear-runs">Clear All</button>
				</div>
				<div class="importonbridge-runs-grid" id="importonbridge-runs-grid">
					<div class="importonbridge-runs-header">
						<span>Run ID</span>
						<span>Category</span>
						<span>Status</span>
						<span>Total</span>
						<span>Success</span>
						<span>Failed</span>
						<span>Log</span>
					</div>
					<div class="importonbridge-runs-body" id="importonbridge-url-import-runs-body">
						<div class="importonbridge-empty-state">No import runs yet.</div>
					</div>
				</div>
			</div>
		</div>

		<?php
	}

	private static function get_quota_js(): string {
		return <<<'JS'
(function () {
	var cfg   = window.importonbridgeUrlImportData || {};
	var quota = cfg.quota || {};
	var limit = cfg.quotaLimit || 20;

	var pill       = document.getElementById('importonbridge-quota-pill');
	var bar        = document.getElementById('importonbridge-quota-bar');
	var label      = document.getElementById('importonbridge-quota-label');
	var timer      = document.getElementById('importonbridge-quota-timer');
	var blockedMsg = document.getElementById('importonbridge-quota-blocked-msg');
	var startBtn   = document.getElementById('importonbridge-url-import-start');
	var retryBtn   = document.getElementById('importonbridge-url-import-retry');

	function pad(n) { return n < 10 ? '0' + n : String(n); }

	function formatCountdown(seconds) {
		seconds = Math.max(0, Math.floor(seconds));
		var h = Math.floor(seconds / 3600);
		var m = Math.floor((seconds % 3600) / 60);
		var s = seconds % 60;
		return pad(h) + ':' + pad(m) + ':' + pad(s);
	}

	function applyQuota(q) {
		if (!q) return;
		quota = q;
		var blocked = !q.allowed;
		var isPro   = !!q.is_pro;
		var card    = document.getElementById('importonbridge-quota-card');

		if (isPro) {
			if (card) card.style.display = 'none';
			if (startBtn) startBtn.disabled = false;
			if (retryBtn) retryBtn.disabled = false;
			return;
		}
		if (card) card.style.display = '';

		var remaining = q.remaining || 0;
		var pct       = Math.round(((limit - remaining) / limit) * 100);

		if (bar) {
			bar.style.width = pct + '%';
			bar.style.background = blocked ? '#666' : (remaining <= 5 ? '#888' : '');
		}

		if (pill) {
			pill.className = 'importonbridge-status-pill ' + (blocked ? 'importonbridge-status-pill--danger' : (remaining <= 5 ? 'importonbridge-status-pill--warning' : 'importonbridge-status-pill--success'));
			pill.textContent = blocked ? 'Blocked' : remaining + ' left';
		}

		if (label && !blocked) {
			label.textContent = remaining + ' of ' + limit + ' imports remaining this hour';
		}

		if (blockedMsg) {
			blockedMsg.style.display = blocked ? '' : 'none';
		}

		if (timer) {
			timer.style.display = blocked ? '' : 'none';
		}

		if (startBtn) startBtn.disabled = blocked;
		if (retryBtn && blocked) retryBtn.disabled = true;
	}

	var countdownInterval = null;
	function startCountdown(cooldownUntil) {
		if (countdownInterval) clearInterval(countdownInterval);
		countdownInterval = setInterval(function () {
			var remaining = cooldownUntil - Math.floor(Date.now() / 1000);
			if (!timer) return;
			if (remaining <= 0) {
				clearInterval(countdownInterval);
				timer.textContent = '';
				pollQuota();
				return;
			}
			timer.textContent = formatCountdown(remaining);
		}, 1000);
	}

	function pollQuota() {
		if (!cfg.ajaxUrl || !cfg.nonce) return;
		var body = new URLSearchParams();
		body.set('action', 'importonbridge_get_quota');
		body.set('nonce', cfg.nonce);
		fetch(cfg.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: body.toString()
		})
		.then(function (r) { return r.json(); })
		.then(function (data) {
			if (data && data.success && data.data && data.data.quota) {
				applyQuota(data.data.quota);
				if (!data.data.quota.allowed && data.data.quota.cooldown_until) {
					startCountdown(data.data.quota.cooldown_until);
				}
			}
		})
		.catch(function () {});
	}

	applyQuota(quota);
	if (quota && !quota.allowed && quota.cooldown_until) {
		startCountdown(quota.cooldown_until);
	}

	setInterval(pollQuota, 60000);
})();
JS;
	}

	private static function assert_access(): void {
		if ( ! self::can_manage() ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'importon-bridge' ) );
		}
	}

	private static function can_manage(): bool {
		$cap = class_exists( 'WooCommerce' ) ? 'manage_woocommerce' : 'manage_options';
		return current_user_can( $cap );
	}

	private static function build_ai_settings_from_post( array $current, array $post ): array {
		$new_openai_key = isset( $post['importonbridge_ai_openai_api_key'] ) ? sanitize_text_field( (string) $post['importonbridge_ai_openai_api_key'] ) : '';
		if ( $new_openai_key !== '' ) {
			$current['openai_api_key'] = $new_openai_key;
			$current['api_key']        = $new_openai_key;
		}

		$new_gemini_key = isset( $post['importonbridge_ai_gemini_api_key'] ) ? sanitize_text_field( (string) $post['importonbridge_ai_gemini_api_key'] ) : '';
		if ( $new_gemini_key !== '' ) {
			$current['gemini_api_key'] = $new_gemini_key;
		}

		// Text field holds the real model ID (JS updates it when preset selected, user types when custom).
		$openai_model = isset( $post['importonbridge_ai_openai_model'] ) ? sanitize_text_field( (string) $post['importonbridge_ai_openai_model'] ) : '';
		if ( $openai_model === '' || $openai_model === 'custom' ) {
			$openai_model = isset( $post['importonbridge_ai_openai_model_select'] ) ? sanitize_text_field( (string) $post['importonbridge_ai_openai_model_select'] ) : '';
		}
		if ( $openai_model === '' || $openai_model === 'custom' ) {
			$openai_model = 'gpt-4o-mini';
		}
		$gemini_model = isset( $post['importonbridge_ai_gemini_model'] ) ? sanitize_text_field( (string) $post['importonbridge_ai_gemini_model'] ) : '';
		if ( $gemini_model === '' || $gemini_model === 'custom' ) {
			$gemini_model = isset( $post['importonbridge_ai_gemini_model_select'] ) ? sanitize_text_field( (string) $post['importonbridge_ai_gemini_model_select'] ) : '';
		}
		if ( $gemini_model === '' || $gemini_model === 'custom' ) {
			$gemini_model = 'gemini-2.5-flash';
		}
		$current['openai_model'] = $openai_model;
		$current['gemini_model'] = $gemini_model;

		$provider_order = isset( $post['importonbridge_ai_provider_order'] ) ? sanitize_key( (string) $post['importonbridge_ai_provider_order'] ) : 'openai_first';
		if ( ! in_array( $provider_order, array( 'openai_first', 'gemini_first' ), true ) ) {
			$provider_order = 'openai_first';
		}

		$current['enabled']        = ! empty( $post['importonbridge_ai_enabled'] );
		$current['rewrite_title']  = ! empty( $post['importonbridge_rewrite_title'] );
		$current['rewrite_description'] = ! empty( $post['importonbridge_rewrite_description'] );
		$current['cta_url']        = isset( $post['importonbridge_cta_url'] ) ? esc_url_raw( (string) $post['importonbridge_cta_url'] ) : '';
		$current['keywords']       = isset( $post['importonbridge_keywords'] ) ? sanitize_text_field( (string) $post['importonbridge_keywords'] ) : '';
		$current['title_prompt_instructions'] = isset( $post['importonbridge_title_prompt_instructions'] ) ? sanitize_textarea_field( (string) $post['importonbridge_title_prompt_instructions'] ) : '';
		$current['description_prompt_instructions'] = isset( $post['importonbridge_description_prompt_instructions'] ) ? sanitize_textarea_field( (string) $post['importonbridge_description_prompt_instructions'] ) : '';
		$current['tag_prompt_instructions'] = isset( $post['importonbridge_tag_prompt_instructions'] ) ? sanitize_textarea_field( (string) $post['importonbridge_tag_prompt_instructions'] ) : '';
		$current['provider_order'] = $provider_order;
		$current['auto_tags']      = ! empty( $post['importonbridge_auto_tags'] );
		$current['auto_sku_format'] = ! empty( $post['importonbridge_auto_sku_format'] );
		$current['sku_prefix']      = self::sanitize_sku_format_part( isset( $post['importonbridge_sku_prefix'] ) ? (string) $post['importonbridge_sku_prefix'] : 'F', 'F' );
		$current['sku_middle_prefix'] = self::sanitize_sku_format_part( isset( $post['importonbridge_sku_middle_prefix'] ) ? (string) $post['importonbridge_sku_middle_prefix'] : 'G', 'G' );
		$current['sku_suffix']        = self::sanitize_sku_format_part( isset( $post['importonbridge_sku_suffix'] ) ? (string) $post['importonbridge_sku_suffix'] : 'K', 'K' );
		$current['sku_number_length'] = self::sanitize_sku_number_length( isset( $post['importonbridge_sku_number_length'] ) ? $post['importonbridge_sku_number_length'] : 3 );

		return $current;
	}

	private static function sanitize_sku_format_part( string $value, string $fallback ): string {
		$value = strtoupper( trim( $value ) );
		$value = preg_replace( '/[^A-Z0-9_-]/', '', $value );
		if ( ! is_string( $value ) || $value === '' ) {
			return $fallback;
		}
		return substr( $value, 0, 8 );
	}

	private static function sanitize_sku_number_length( $value ): int {
		$length = (int) $value;
		if ( $length < 1 ) {
			$length = 1;
		}
		if ( $length > 8 ) {
			$length = 8;
		}
		return $length;
	}

	private static function handle_settings_postback(): array {
		$ai_notice = '';
		$ai_error  = '';
		$ai_settings = get_option( 'importonbridge_ai_settings', array() );
		if ( ! is_array( $ai_settings ) ) {
			$ai_settings = array();
		}

		if ( isset( $_POST['importonbridge_save_ai_settings'] ) || isset( $_POST['importonbridge_test_openai_api'] ) || isset( $_POST['importonbridge_test_gemini_api'] ) ) {
			check_admin_referer( 'importonbridge_save_ai_settings_action', 'importonbridge_save_ai_settings_nonce' );

			$ai_settings = self::build_ai_settings_from_post( $ai_settings, wp_unslash( $_POST ) );

			if ( isset( $_POST['importonbridge_save_ai_settings'] ) ) {
				update_option( 'importonbridge_ai_settings', $ai_settings );
				$ai_notice = 'AI settings saved.';
			}

			if ( isset( $_POST['importonbridge_test_openai_api'] ) || isset( $_POST['importonbridge_test_gemini_api'] ) ) {
				$provider    = isset( $_POST['importonbridge_test_gemini_api'] ) ? 'gemini' : 'openai';
				$test_result = ImportonBridge_Rest::test_ai_provider_connection( $ai_settings, $provider );
				if ( ! empty( $test_result['ok'] ) ) {
					$ai_notice = isset( $test_result['message'] ) ? (string) $test_result['message'] : ucfirst( $provider ) . ' connection succeeded.';
				} else {
					$ai_error = isset( $test_result['message'] ) ? (string) $test_result['message'] : ucfirst( $provider ) . ' connection failed.';
				}
			}
		}

		$ai_enabled            = ! isset( $ai_settings['enabled'] ) ? true : ! empty( $ai_settings['enabled'] );
		$ai_rewrite_title      = ! isset( $ai_settings['rewrite_title'] ) ? true : ! empty( $ai_settings['rewrite_title'] );
		$ai_rewrite_description = ! isset( $ai_settings['rewrite_description'] ) ? true : ! empty( $ai_settings['rewrite_description'] );
		$ai_openai_key_saved   = ! empty( $ai_settings['openai_api_key'] ) || ! empty( $ai_settings['api_key'] );
		$ai_gemini_key_saved   = ! empty( $ai_settings['gemini_api_key'] );
		$ai_cta_url            = isset( $ai_settings['cta_url'] ) ? (string) $ai_settings['cta_url'] : '';
		$ai_keywords           = isset( $ai_settings['keywords'] ) ? (string) $ai_settings['keywords'] : '';
		$ai_title_prompt_instructions = isset( $ai_settings['title_prompt_instructions'] ) ? (string) $ai_settings['title_prompt_instructions'] : '';
		$ai_description_prompt_instructions = isset( $ai_settings['description_prompt_instructions'] ) ? (string) $ai_settings['description_prompt_instructions'] : '';
		$ai_tag_prompt_instructions = isset( $ai_settings['tag_prompt_instructions'] ) ? (string) $ai_settings['tag_prompt_instructions'] : '';
		$ai_provider_order     = isset( $ai_settings['provider_order'] ) && in_array( $ai_settings['provider_order'], array( 'openai_first', 'gemini_first' ), true ) ? (string) $ai_settings['provider_order'] : 'openai_first';
		$ai_openai_model       = isset( $ai_settings['openai_model'] ) && is_string( $ai_settings['openai_model'] ) && $ai_settings['openai_model'] !== '' ? (string) $ai_settings['openai_model'] : 'gpt-4o';
		$ai_gemini_model       = isset( $ai_settings['gemini_model'] ) && is_string( $ai_settings['gemini_model'] ) && $ai_settings['gemini_model'] !== '' ? (string) $ai_settings['gemini_model'] : 'gemini-2.5-flash';
		$ai_auto_tags          = ! empty( $ai_settings['auto_tags'] );
		$ai_auto_sku_format    = ! empty( $ai_settings['auto_sku_format'] );
		$ai_sku_prefix         = self::sanitize_sku_format_part( isset( $ai_settings['sku_prefix'] ) ? (string) $ai_settings['sku_prefix'] : 'F', 'F' );
		$ai_sku_middle_prefix  = self::sanitize_sku_format_part( isset( $ai_settings['sku_middle_prefix'] ) ? (string) $ai_settings['sku_middle_prefix'] : 'G', 'G' );
		$ai_sku_suffix         = self::sanitize_sku_format_part( isset( $ai_settings['sku_suffix'] ) ? (string) $ai_settings['sku_suffix'] : 'K', 'K' );
		$ai_sku_number_length  = self::sanitize_sku_number_length( isset( $ai_settings['sku_number_length'] ) ? $ai_settings['sku_number_length'] : 3 );

		$app_password_created = null;
		$app_password_error   = '';
		$app_password_notice  = '';

		if ( isset( $post['importonbridge_revoke_apppass'] ) ) {
			check_admin_referer( 'importonbridge_apppass_action', 'importonbridge_apppass_nonce' );

			$uuid = isset( $post['importonbridge_revoke_uuid'] ) ? sanitize_text_field( (string) $post['importonbridge_revoke_uuid'] ) : '';
			if ( $uuid === '' ) {
				$app_password_error = 'Missing application password id.';
			} elseif ( ! class_exists( 'WP_Application_Passwords' ) ) {
				$app_password_error = 'Application Passwords are not available on this WordPress installation.';
			} else {
				$res = WP_Application_Passwords::delete_application_password( get_current_user_id(), $uuid );
				if ( is_wp_error( $res ) ) {
					$app_password_error = $res->get_error_message();
				} else {
					$app_password_notice = 'Application Password revoked.';
				}
			}
		}

		if ( isset( $post['importonbridge_create_apppass'] ) ) {
			check_admin_referer( 'importonbridge_apppass_action', 'importonbridge_apppass_nonce' );

			$name = isset( $post['importonbridge_apppass_name'] ) ? sanitize_text_field( (string) $post['importonbridge_apppass_name'] ) : '';
			if ( $name === '' ) {
				$app_password_error = 'Please enter an application name.';
			} elseif ( ! class_exists( 'WP_Application_Passwords' ) ) {
				$app_password_error = 'Application Passwords are not available on this WordPress installation.';
			} elseif ( ! function_exists( 'wp_is_application_passwords_available_for_user' ) || ! wp_is_application_passwords_available_for_user( get_current_user_id() ) ) {
				$app_password_error = 'Application Passwords are disabled for this site/user.';
			} else {
				$res = WP_Application_Passwords::create_new_application_password(
					get_current_user_id(),
					array( 'name' => $name )
				);

				if ( is_wp_error( $res ) ) {
					$app_password_error = $res->get_error_message();
				} elseif ( is_array( $res ) && ! empty( $res[0] ) ) {
					$app_password_created = (string) $res[0];
				} else {
					$app_password_error = 'Failed to create application password.';
				}
			}
		}

		$existing_passwords = array();
		if ( class_exists( 'WP_Application_Passwords' ) ) {
			$existing_passwords = WP_Application_Passwords::get_user_application_passwords( get_current_user_id() );
			if ( ! is_array( $existing_passwords ) ) {
				$existing_passwords = array();
			}
		}

		return array(
			'ai_notice'           => $ai_notice,
			'ai_error'            => $ai_error,
			'ai_enabled'          => $ai_enabled,
			'ai_rewrite_title'    => $ai_rewrite_title,
			'ai_rewrite_description' => $ai_rewrite_description,
			'ai_openai_key_saved' => $ai_openai_key_saved,
			'ai_gemini_key_saved' => $ai_gemini_key_saved,
			'ai_provider_order'   => $ai_provider_order,
			'ai_openai_model'     => $ai_openai_model,
			'ai_gemini_model'     => $ai_gemini_model,
			'ai_cta_url'          => $ai_cta_url,
			'ai_keywords'         => $ai_keywords,
			'ai_title_prompt_instructions' => $ai_title_prompt_instructions,
			'ai_description_prompt_instructions' => $ai_description_prompt_instructions,
			'ai_tag_prompt_instructions' => $ai_tag_prompt_instructions,
			'ai_auto_tags'        => $ai_auto_tags,
			'ai_auto_sku_format'  => $ai_auto_sku_format,
			'ai_sku_prefix'       => $ai_sku_prefix,
			'ai_sku_middle_prefix'=> $ai_sku_middle_prefix,
			'ai_sku_suffix'       => $ai_sku_suffix,
			'ai_sku_number_length'=> $ai_sku_number_length,
			'app_password_created'=> $app_password_created,
			'app_password_error'  => $app_password_error,
			'app_password_notice' => $app_password_notice,
			'existing_passwords'  => $existing_passwords,
		);
	}

	private static function get_common_admin_css(): string {
		return implode(
			"\n",
			array(
				/* Minimal Professional Design - Grayscale Only */
				'.importonbridge-shell { --bg: #fafafa; --card: #fff; --text: #222; --text-light: #666; --border: #e0e0e0; --border-strong: #ccc; width: 100%; max-width: 100%; margin: 0; color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
				'.importonbridge-wrap { width: 100%; max-width: 1200px; margin: 20px auto; clear: both; overflow: visible; padding-bottom: 120px; }',
				'.importonbridge-shell *, .importonbridge-shell *::before, .importonbridge-shell *::after { box-sizing: border-box; }',
				'.importonbridge-shell a { color: #333; text-decoration: underline; }',
				'.importonbridge-wrap.importonbridge-shell { padding-right: 16px; }',
				/* Hero - Minimal dark */
				'.importonbridge-hero { display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: center; margin-bottom: 20px; padding: 24px 28px; background: #222; color: #fff; border-radius: 8px; }',
				'.importonbridge-hero-copy h1 { margin: 0; font-size: 22px; font-weight: 600; color: #fff; letter-spacing: -0.02em; }',
				'.importonbridge-hero-copy p { margin: 8px 0 0; color: #aaa; font-size: 13px; max-width: 600px; line-height: 1.5; }',
				'.importonbridge-hero-side { display: flex; gap: 8px; flex-wrap: wrap; }',
				'.importonbridge-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
				/* Download Button */
				'.importonbridge-btn-download { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-weight: 500; font-size: 13px; cursor: pointer; text-decoration: none; border: 1px solid var(--border-strong); background: #fff; color: #333; }',
				'.importonbridge-btn-download:hover { border-color: #666; background: #fafafa; }',
				/* Quota warning icon */
				'.importonbridge-quota-warning { display: inline-block; margin-left: 6px; color: #666; cursor: help; font-size: 14px; transition: color 0.2s; }',
				'.importonbridge-quota-warning:hover { color: #dc2626; }',
				/* Let freemius handle the upgrade styling - no custom CSS needed */
				/* Grids */
				'.importonbridge-overview-grid, .importonbridge-panel-grid, .importonbridge-grid { display: grid; gap: 16px; }',
				'.importonbridge-overview-grid { grid-template-columns: repeat(2, 1fr); margin-bottom: 16px; }',
				'.importonbridge-panel-grid { grid-template-columns: repeat(2, 1fr); margin-bottom: 16px; }',
				'.importonbridge-grid--import { grid-template-columns: 1fr 340px; margin-bottom: 16px; }',
				'.importonbridge-grid--tables { grid-template-columns: repeat(2, 1fr); }',
				/* Cards - Clean minimal */
				'.importonbridge-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }',
				'.importonbridge-card--soft { background: #fafafa; }',
				'.importonbridge-card--highlight { background: #fff; border-color: #ccc; }',
				'.importonbridge-card--cta { margin-top: 0; }',
				'.importonbridge-card--recent { margin-top: 16px; }',
				'.importonbridge-card-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }',
				'.importonbridge-card-head--compact { margin-bottom: 12px; }',
				'.importonbridge-card-head--top-gap { margin-top: 20px; }',
				'.importonbridge-card-head h2, .importonbridge-card-head h3 { margin: 0; color: var(--text); }',
				'.importonbridge-card-head h2 { font-size: 16px; font-weight: 600; }',
				'.importonbridge-card-head h3 { font-size: 14px; font-weight: 600; }',
				'.importonbridge-card-head p { margin: 4px 0 0; color: var(--text-light); font-size: 13px; }',
				/* Checklist */
				'.importonbridge-checklist { display: grid; gap: 10px; }',
				'.importonbridge-checklist-item { display: grid; grid-template-columns: 24px 1fr; gap: 10px; align-items: start; color: var(--text); font-size: 13px; }',
				'.importonbridge-checkmark { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #eee; color: #666; font-size: 12px; font-weight: 600; }',
				/* Info Grid */
				'.importonbridge-info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }',
				'.importonbridge-info-grid--compact { grid-template-columns: 1fr; }',
				'.importonbridge-info-item { padding: 12px; border-radius: 6px; border: 1px solid var(--border); background: #fff; min-width: 0; }',
				'.importonbridge-info-item code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; user-select: all; font-size: 12px; }',
				'.importonbridge-info-label { display: block; margin-bottom: 4px; color: var(--text-light); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }',
				/* Alerts - Minimal grayscale */
				'.importonbridge-alert { margin-bottom: 14px; padding: 12px 14px; border-radius: 6px; border: 1px solid; font-size: 13px; }',
				'.importonbridge-alert--success { color: #333; background: #f5f5f5; border-color: #ddd; }',
				'.importonbridge-alert--danger { color: #333; background: #fafafa; border-color: #ddd; }',
				/* Forms */
				'.importonbridge-form-stack { display: grid; gap: 16px; }',
				'.importonbridge-ai-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid var(--border); border-radius: 8px; background: #fafafa; overflow: hidden; }',
				'.importonbridge-ai-summary-item { min-width: 0; padding: 12px 16px; border-right: 1px solid var(--border); }',
				'.importonbridge-ai-summary-item:last-child { border-right: 0; }',
				'.importonbridge-ai-summary-label { display: block; margin-bottom: 4px; color: var(--text-light); font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }',
				'.importonbridge-ai-summary-value { display: block; color: var(--text); font-size: 14px; line-height: 1.4; }',
				/* Accordion */
				'.importonbridge-accordion { border: 1px solid var(--border); border-radius: 8px; background: #fff; overflow: hidden; }',
				'.importonbridge-accordion summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; cursor: pointer; list-style: none; font-size: 14px; font-weight: 500; }',
				'.importonbridge-accordion summary::-webkit-details-marker { display: none; }',
				'.importonbridge-accordion summary::after { content: "+"; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #eee; color: #666; font-size: 14px; font-weight: 600; flex: 0 0 auto; }',
				'.importonbridge-accordion[open] summary::after { content: "−"; }',
				'.importonbridge-accordion-copy { display: grid; gap: 4px; min-width: 0; }',
				'.importonbridge-accordion-title { color: var(--text); font-size: 14px; font-weight: 600; }',
				'.importonbridge-accordion-meta { color: var(--text-light); font-size: 12px; line-height: 1.4; }',
				'.importonbridge-accordion-body { padding: 0 16px 16px; border-top: 1px solid var(--border); background: #fff; }',
				'.importonbridge-accordion-body .importonbridge-kv:first-child { padding-top: 16px; }',
				'.importonbridge-kv { display: grid; grid-template-columns: 180px 1fr; gap: 12px 16px; align-items: start; }',
				'.importonbridge-k { color: var(--text); font-weight: 500; padding-top: 8px; font-size: 13px; }',
				'.importonbridge-v { min-width: 0; }',
				'.importonbridge-v code { user-select: all; }',
				/* Inline controls */
				'.importonbridge-inline-control { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
				'.importonbridge-inline-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; background: #f0f0f0; color: #333; }',
				'.importonbridge-inline-badge--success { background: #eee; color: #333; }',
				/* Form inputs - Minimal clean */
				'.importonbridge-form { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; }',
				'.importonbridge-form--password .importonbridge-form-action { display: flex; align-items: flex-end; height: 100%; }',
				'.importonbridge-inline-form { margin: 0; }',
				'.importonbridge-form label, .importonbridge-field label { display: block; margin-bottom: 6px; color: var(--text); font-weight: 500; font-size: 13px; }',
				'.importonbridge-form input[type="text"], .importonbridge-form input[type="url"], .importonbridge-form input[type="password"], .importonbridge-field input[type="text"], .importonbridge-field input[type="url"], .importonbridge-field textarea, .importonbridge-field select, .importonbridge-v input[type="text"], .importonbridge-v input[type="url"], .importonbridge-v input[type="password"] { width: 100%; min-height: 40px; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 6px; background: #fff; color: var(--text); font-size: 14px; }',
				'.importonbridge-form input:focus, .importonbridge-field input:focus, .importonbridge-field textarea:focus, .importonbridge-field select:focus, .importonbridge-v input:focus { border-color: #666; outline: none; }',
				'.importonbridge-field textarea, .importonbridge-v textarea { width: 100%; min-height: 80px; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 6px; background: #fff; color: var(--text); font-size: 13px; font-family: inherit; line-height: 1.5; resize: vertical; box-sizing: border-box; }',
				'.importonbridge-v textarea:focus { border-color: #666; outline: none; }',
				'.importonbridge-field-help { margin-top: 6px; color: var(--text-light); font-size: 12px; }',
				/* Toggle */
				'.importonbridge-toggle { display: inline-flex; align-items: center; gap: 10px; font-weight: 500; font-size: 13px; }',
				'.importonbridge-toggle input { margin: 0; }',
				/* Buttons - Minimal outline style */
				'.importonbridge-actions { display: grid; gap: 8px; }',
				'.importonbridge-btn, .importonbridge-copy, .importonbridge-ghost-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 10px 16px; border-radius: 999px; font-weight: 900; cursor: pointer; text-decoration: none; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease; }',
				'.importonbridge-btn, .importonbridge-btn:visited, .importonbridge-btn:hover, .importonbridge-btn:focus { color: #fff !important; }',
				'.importonbridge-btn { border: 1px solid #111827; background: #111827; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }',
				'.importonbridge-btn:hover { background: #1f2937; border-color: #1f2937; }',
				'.importonbridge-btn[disabled] { opacity: .55; cursor: not-allowed; box-shadow: none; background: #9ca3af; border-color: #9ca3af; }',
				'.importonbridge-copy, .importonbridge-ghost-btn { border: 1px solid var(--border-strong); background: #fff; color: #333; }',
				'.importonbridge-copy:hover, .importonbridge-ghost-btn:hover { border-color: #666; background: #fafafa; }',
				/* Help */
				'.importonbridge-help-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }',
				'.importonbridge-help-trigger { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border); background: #fafafa; color: #666; font-size: 12px; font-weight: 600; cursor: help; }',
				'.importonbridge-help-trigger:focus { outline: none; box-shadow: 0 0 0 2px #ccc; }',
				'.importonbridge-help-tooltip { position: absolute; top: calc(100% + 8px); right: 0; width: min(300px, 70vw); padding: 10px 12px; border-radius: 6px; background: #333; color: #fff; font-size: 12px; line-height: 1.5; box-shadow: 0 4px 12px rgba(0,0,0,.15); opacity: 0; visibility: hidden; transform: translateY(-4px); transition: all .15s ease; z-index: 20; }',
				'.importonbridge-help-tooltip::before { content: ""; position: absolute; top: -5px; right: 10px; width: 10px; height: 10px; background: #333; transform: rotate(45deg); }',
				'.importonbridge-help-wrap:hover .importonbridge-help-tooltip, .importonbridge-help-wrap:focus-within .importonbridge-help-tooltip { opacity: 1; visibility: visible; transform: translateY(0); }',
				/* Password display */
				'.importonbridge-pass { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: #fafafa; }',
				'.importonbridge-pass-title { margin-bottom: 8px; font-weight: 600; color: var(--text); font-size: 13px; }',
				'.importonbridge-pass-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }',
				'.importonbridge-pass code { display: inline-block; padding: 8px 10px; border-radius: 4px; background: #fff; border: 1px solid var(--border); font-size: 12px; overflow-wrap: anywhere; }',
				'.importonbridge-subsection { margin-top: 16px; }',
				'.importonbridge-form-inline { display: grid; grid-template-columns: 1fr 200px; gap: 12px; align-items: end; margin-top: 12px; }',
				'.importonbridge-field-actions { min-width: 0; }',
				'.importonbridge-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }',
				/* Note box */
				'.importonbridge-note-box { margin-top: 0; padding: 12px; border-radius: 6px; background: #fafafa; border: 1px solid var(--border); color: #333; font-size: 13px; }',
				'.importonbridge-note-box--status { display: grid; gap: 6px; }',
				'.importonbridge-note-box--hidden { display: none; }',
				'.importonbridge-note-box--status[data-tone="success"] { background: #f5f5f5; border-color: #ddd; }',
				'.importonbridge-note-box--status[data-tone="warning"] { background: #fafafa; border-color: #ddd; }',
				'.importonbridge-note-box--status[data-tone="danger"] { background: #fafafa; border-color: #ddd; }',
				/* Status pills - Minimal grayscale */
				'.importonbridge-status-pill { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 500; letter-spacing: 0.03em; background: #f0f0f0; color: #333; }',
				'.importonbridge-status-pill--neutral { background: #f0f0f0; color: #333; }',
				'.importonbridge-status-pill--success { background: #eee; color: #333; }',
				'.importonbridge-status-pill--warning { background: #f0f0f0; color: #333; }',
				'.importonbridge-status-pill--danger { background: #f5f5f5; color: #333; }',
				/* Stats */
				'.importonbridge-run-overview { display: grid; gap: 12px; }',
				'.importonbridge-run-status-card { display: grid; gap: 10px; padding: 16px; border-radius: 8px; border: 1px solid var(--border); background: #fafafa; }',
				'.importonbridge-run-status-meta { display: grid; gap: 6px; }',
				'.importonbridge-run-status-value { font-size: 28px; line-height: 1.1; font-weight: 600; color: var(--text); word-break: break-word; }',
				'.importonbridge-run-status-text { margin: 0; color: var(--text-light); line-height: 1.4; }',
				'.importonbridge-run-stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }',
				'.importonbridge-run-stats-grid .importonbridge-stat-box--status { grid-column: 1 / -1; }',
				'.importonbridge-stat { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px; }',
				'.importonbridge-stat--compact .importonbridge-stat-value { font-size: 22px; }',
				'.importonbridge-stat-label { color: var(--text-light); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }',
				'.importonbridge-stat-value { margin-top: 6px; font-size: 26px; line-height: 1; font-weight: 600; color: var(--text); }',
				/* Stats box for usage page */
				'.importonbridge-stat-box { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }',
				'.importonbridge-stat-box .importonbridge-stat-label { margin-bottom: 8px; }',
				'.importonbridge-stat-box .importonbridge-stat-value { font-size: 28px; margin-top: 0; }',
				'.importonbridge-stats-row { display: grid; gap: 16px; margin-bottom: 20px; }',
				/* Progress bar */
				'.importonbridge-progress { margin-top: 12px; width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden; }',
				'.importonbridge-progress-bar { width: 0; height: 100%; background: #666; transition: width .2s ease; }',
				'.importonbridge-muted { color: var(--text-light); }',
				'.importonbridge-empty-state { color: var(--text-light); text-align: center; padding: 16px; font-size: 13px; }',
				/* Tables */
				'.importonbridge-table-wrap { width: 100%; overflow: hidden; }',
				'.importonbridge-table-wrap--recent { overflow: visible; }',
				'.importonbridge-table { width: 100%; min-width: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }',
				'.importonbridge-table thead th { background: #fafafa; color: var(--text-light); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 12px; text-align: left; }',
				'.importonbridge-table td, .importonbridge-table th { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }',
				'.importonbridge-table tr:last-child td { border-bottom: none; }',
				'.importonbridge-run-table { table-layout: fixed; }',
				'.importonbridge-run-table td, .importonbridge-run-table th { overflow-wrap: anywhere; word-break: break-word; }',
				'.importonbridge-failed-table td, .importonbridge-run-table td { vertical-align: top; }',
				/* Enhanced Recent Runs Grid */
				'.importonbridge-runs-grid { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #fff; }',
				'.importonbridge-runs-header { display: grid; grid-template-columns: 1.5fr 1fr 100px 70px 70px 70px 80px; gap: 8px; padding: 12px 16px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }',
				'.importonbridge-runs-body { max-height: 300px; overflow-y: auto; }',
				'.importonbridge-run-row { display: grid; grid-template-columns: 1.5fr 1fr 100px 70px 70px 70px 80px; gap: 8px; padding: 14px 16px; align-items: center; border-bottom: 1px solid #f1f5f9; transition: background 0.15s ease; }',
				'.importonbridge-run-row:hover { background: #f8fafc; }',
				'.importonbridge-run-row:last-child { border-bottom: none; }',
				'.importonbridge-run-col { font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
				'.importonbridge-run-id { font-family: monospace; font-size: 11px; color: #64748b; }',
				'.importonbridge-run-category { color: #475569; }',
				'.importonbridge-run-total, .importonbridge-run-success, .importonbridge-run-failed { text-align: center; font-weight: 600; }',
				'.importonbridge-log-link { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #2563eb; background: #eff6ff; text-decoration: none; transition: all 0.15s ease; }',
				'.importonbridge-log-link:hover { background: #2563eb; color: #fff; }',
				'.importonbridge-status-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }',
				'.importonbridge-status-success { background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); color: #166534; }',
				'.importonbridge-status-danger { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #991b1b; }',
				'.importonbridge-status-running { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); color: #1e40af; }',
				'.importonbridge-status-pending { background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); color: #475569; }',
				/* Responsive */
				'@media (max-width: 900px) { .importonbridge-runs-header, .importonbridge-run-row { grid-template-columns: 1fr 1fr 80px 60px 80px; } .importonbridge-run-category, .importonbridge-run-total, .importonbridge-run-log { display: none; } }',
				'@media (max-width: 600px) { .importonbridge-runs-grid { border-radius: 8px; } .importonbridge-runs-header { display: none; } .importonbridge-run-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; } .importonbridge-run-col { font-size: 12px; } .importonbridge-run-id { width: 100%; font-size: 10px; } }',
				/* ===== RESPONSIVE STYLES ===== */
				/* Large Desktop - 1200px+ */
				'@media (min-width: 1200px) { .importonbridge-grid--import { grid-template-columns: 1fr 360px; } }',
				/* Tablet - 1080px */
				'@media (max-width: 1080px) { .importonbridge-overview-grid, .importonbridge-panel-grid, .importonbridge-grid--tables, .importonbridge-grid--import, .importonbridge-hero, .importonbridge-ai-summary { grid-template-columns: 1fr; } .importonbridge-ai-summary { grid-template-columns: repeat(2, 1fr); } .importonbridge-ai-summary-item { border-right: 0; border-bottom: 1px solid var(--border); } .importonbridge-ai-summary-item:nth-last-child(-n+2) { border-bottom: 0; } .importonbridge-hero--settings .importonbridge-hero-side { justify-content: flex-start; } .importonbridge-hero-actions { justify-content: flex-start; } .importonbridge-grid--import { grid-template-columns: 1fr; } }',
				/* Small Tablet / Large Mobile - 782px */
				'@media (max-width: 782px) { .importonbridge-wrap { margin: 12px auto; padding-bottom: 100px; } .importonbridge-wrap.importonbridge-shell { padding-right: 8px; padding-left: 8px; } .importonbridge-card { padding: 16px; } .importonbridge-hero { padding: 16px; border-radius: 8px; grid-template-columns: 1fr; gap: 12px; } .importonbridge-hero-copy h1 { font-size: 18px; } .importonbridge-hero-copy p { font-size: 12px; } .importonbridge-hero-side { width: 100%; } .importonbridge-hero-side .importonbridge-btn { width: 100%; justify-content: center; } .importonbridge-kv, .importonbridge-form, .importonbridge-form-inline, .importonbridge-info-grid { grid-template-columns: 1fr; } .importonbridge-k { padding-top: 0; font-size: 14px; } .importonbridge-btn, .importonbridge-copy, .importonbridge-ghost-btn { width: 100%; justify-content: center; } .importonbridge-btn-row { display: grid; grid-template-columns: 1fr; gap: 8px; } .importonbridge-pass-row { align-items: stretch; flex-direction: column; } .importonbridge-pass code { width: 100%; } .importonbridge-ai-summary { grid-template-columns: 1fr 1fr; } .importonbridge-form-inline { grid-template-columns: 1fr; } .importonbridge-field-actions { width: 100%; } .importonbridge-btn-row .importonbridge-btn { width: 100%; } }',
				/* Mobile - 480px */
				'@media (max-width: 480px) { .importonbridge-wrap { margin: 8px auto; padding-bottom: 80px; } .importonbridge-hero { padding: 14px; } .importonbridge-hero-copy h1 { font-size: 16px; } .importonbridge-card { padding: 12px; border-radius: 6px; } .importonbridge-card-head { flex-direction: column; gap: 8px; } .importonbridge-card-head h2 { font-size: 14px; } .importonbridge-card-head p { font-size: 12px; } .importonbridge-ai-summary { grid-template-columns: 1fr; } .importonbridge-ai-summary-item { padding: 10px 12px; } .importonbridge-ai-summary-label { font-size: 9px; } .importonbridge-ai-summary-value { font-size: 13px; } .importonbridge-accordion summary { padding: 12px; flex-wrap: wrap; } .importonbridge-accordion-title { font-size: 13px; } .importonbridge-accordion-meta { font-size: 11px; width: 100%; } .importonbridge-kv { grid-template-columns: 1fr; gap: 8px; } .importonbridge-v { width: 100%; } .importonbridge-form { grid-template-columns: 1fr; } .importonbridge-status-pill { font-size: 10px; padding: 3px 8px; } .importonbridge-stat { padding: 10px; } .importonbridge-stat-label { font-size: 10px; } .importonbridge-stat-value { font-size: 20px; } .importonbridge-table-wrap { font-size: 12px; } .importonbridge-table th, .importonbridge-table td { padding: 8px; } .importonbridge-field input, .importonbridge-field textarea, .importonbridge-field select, .importonbridge-v input, .importonbridge-v textarea { font-size: 13px; padding: 8px 10px; } .importonbridge-field-help { font-size: 11px; } .importonbridge-btn, .importonbridge-copy, .importonbridge-ghost-btn { font-size: 12px; padding: 10px 12px; min-height: 40px; } .importonbridge-note-box { padding: 10px; font-size: 12px; } .importonbridge-help-tooltip { width: 200px; font-size: 11px; } }',
				/* Fix WordPress admin footer overlap */
				'#wpcontent { overflow-x: hidden; }',
				'@media (max-width: 782px) { #wpcontent { padding-bottom: 60px; } }',
				'@media (max-width: 480px) { #wpcontent { padding-bottom: 50px; } }',
				/* Ensure content doesn't get hidden behind fixed footer */
				'.wrap.importonbridge-wrap { position: relative; z-index: 1; }',
				/* Page container */
				'.importonbridge-page { min-height: 500px; padding-bottom: 80px; overflow: hidden; }',
				'@media (max-width: 782px) { .importonbridge-page { min-height: auto; padding-bottom: 60px; } }',
				'@media (max-width: 480px) { .importonbridge-page { padding-bottom: 50px; } }',
				/* Usage page inline styles responsive */
				'.importonbridge-stats-row { display: grid; gap: 16px; }',
				'@media (min-width: 600px) { .importonbridge-stats-row { grid-template-columns: repeat(2, 1fr); } }',
				'@media (min-width: 1080px) { .importonbridge-stats-row { grid-template-columns: repeat(4, 1fr); } }',
				'@media (max-width: 480px) { .importonbridge-stats-row .importonbridge-stat-box { padding: 12px; } .importonbridge-stats-row .importonbridge-stat-box > div:first-child { font-size: 10px; } .importonbridge-stats-row .importonbridge-stat-box > div:last-child { font-size: 22px; } }',
				/* Connect page */
				'.importonbridge-connect-top { display: flex; justify-content: flex-end; margin-bottom: 12px; }',
				'.importonbridge-shell a.importonbridge-download-link { font-size: 13px; font-weight: 600; color: #999; text-decoration: none; padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; transition: color 0.2s, border-color 0.2s, background 0.2s; }',
				'.importonbridge-shell a.importonbridge-download-link:hover { color: #555; border-color: var(--border-strong); background: #f5f5f5; }',
				'@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }',
				'@keyframes gentlePulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,34,34,0.15); } 50% { box-shadow: 0 0 0 8px rgba(34,34,34,0); } }',
				'.importonbridge-connect-hero { text-align: center; padding: 48px 24px; margin-bottom: 24px; border: 1px dashed var(--border); border-radius: 12px; background: #fff; animation: fadeSlideUp 0.5s ease-out; }',
				'.importonbridge-connect-hero-icon { color: #999; margin-bottom: 16px; transition: transform 0.3s ease, color 0.3s ease; }',
				'.importonbridge-connect-hero:hover .importonbridge-connect-hero-icon { transform: translateY(-4px) scale(1.05); color: #666; }',
				'.importonbridge-connect-hero h2 { margin: 0 0 8px; font-size: 22px; font-weight: 600; color: var(--text); }',
				'.importonbridge-connect-hero p { margin: 0 0 20px; color: var(--text-light); font-size: 14px; }',
				'.importonbridge-shell a.importonbridge-btn-primary, .importonbridge-shell button.importonbridge-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; cursor: pointer; text-decoration: none; border: 1px solid #333; background: #222; color: #fff; animation: gentlePulse 2.5s ease-in-out infinite; transition: background 0.2s, transform 0.15s; }',
				'.importonbridge-shell a.importonbridge-btn-primary:hover, .importonbridge-shell button.importonbridge-btn-primary:hover { background: #333; color: #fff; transform: translateY(-1px); }',
				'.importonbridge-shell a.importonbridge-btn-primary:active, .importonbridge-shell button.importonbridge-btn-primary:active { transform: translateY(0); }',
				'.importonbridge-connect-main { margin-top: 0; }',
				/* Pulse animation for running status */
				'@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.1); } }',
			)
		);
	}

	// ── USAGE page ───────────────────────────────────────────────────────────

	public static function render_usage_page(): void {
		self::assert_access();

		global $wpdb;
		$table = esc_sql( preg_replace( '/[^A-Za-z0-9_]/', '', $wpdb->prefix . 'importonbridge_usage_log' ) );

		if ( isset( $_POST['importonbridge_clear_usage'] ) && check_admin_referer( 'importonbridge_clear_usage_action', 'importonbridge_clear_usage_nonce' ) ) {
			// $table is derived solely from $wpdb->prefix (not user input) so interpolation is safe.
			// TRUNCATE cannot be parameterised via $wpdb->prepare().
			$wpdb->query( "TRUNCATE TABLE `{$table}`" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		}

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		$model_totals = $wpdb->get_results(
			"SELECT model, provider,
				SUM(input_tokens)  AS total_input,
				SUM(output_tokens) AS total_output,
				SUM(cost_usd)      AS total_cost,
				COUNT(*)           AS calls
			FROM {$table}
			GROUP BY model, provider
			ORDER BY total_cost DESC",
			ARRAY_A
		) ?: array();

		$grand = $wpdb->get_row(
			"SELECT
				SUM(input_tokens)         AS input,
				SUM(output_tokens)        AS output,
				SUM(cost_usd)             AS cost,
				COUNT(DISTINCT product_id) AS products
			FROM {$table}",
			ARRAY_A
		) ?: array();

		$rows = $wpdb->get_results(
			"SELECT product_id, product_title, model, provider,
				SUM(input_tokens)  AS input_tok,
				SUM(output_tokens) AS output_tok,
				SUM(cost_usd)      AS cost,
				MAX(created_at)    AS last_run
			FROM {$table}
			GROUP BY product_id, model, provider
			ORDER BY last_run DESC
			LIMIT 200",
			ARRAY_A
		) ?: array();
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching

		$fmt_cost = static function ( $usd ): string {
			$usd = (float) $usd;
			if ( $usd <= 0 )    return '$0.0000';
			if ( $usd >= 0.01 ) return '$' . number_format( $usd, 4 );
			return number_format( $usd * 100, 4 ) . '¢';
		};

		$total_products = (int) ( $grand['products'] ?? 0 );
		$total_input    = (int) ( $grand['input']    ?? 0 );
		$total_output   = (int) ( $grand['output']   ?? 0 );
		$total_cost     = $fmt_cost( $grand['cost'] ?? 0 );
		?>
		<div class="importonbridge-wrap importonbridge-shell importonbridge-page">

			<div class="importonbridge-hero importonbridge-hero--import">
				<div class="importonbridge-hero-copy">
					<h1>AI Usage</h1>
					<p>Exact token counts and costs per product import. Updates each time you run a URL import or manual import.</p>
				</div>
				<div class="importonbridge-hero-side">
					<div class="importonbridge-hero-actions">
						<a class="importonbridge-ghost-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=importon-bridge' ) ); ?>">Settings</a>
					</div>
				</div>
			</div>

			<div class="importonbridge-run-stats-grid" style="margin-top:12px;">
				<div class="importonbridge-stat importonbridge-stat--compact">
					<div class="importonbridge-stat-label">Products Logged</div>
					<div class="importonbridge-stat-value"><?php echo esc_html( number_format( $total_products ) ); ?></div>
				</div>
				<div class="importonbridge-stat importonbridge-stat--compact">
					<div class="importonbridge-stat-label">Input Tokens</div>
					<div class="importonbridge-stat-value"><?php echo esc_html( number_format( $total_input ) ); ?></div>
				</div>
				<div class="importonbridge-stat importonbridge-stat--compact">
					<div class="importonbridge-stat-label">Output Tokens</div>
					<div class="importonbridge-stat-value"><?php echo esc_html( number_format( $total_output ) ); ?></div>
				</div>
				<div class="importonbridge-stat importonbridge-stat--compact">
					<div class="importonbridge-stat-label">Total Cost</div>
					<div class="importonbridge-stat-value"><?php echo esc_html( $total_cost ); ?></div>
				</div>
			</div>

			<div class="importonbridge-grid importonbridge-grid--tables" style="margin-top:12px;">

				<div class="importonbridge-card importonbridge-card--section">
					<div class="importonbridge-card-head">
						<div>
							<h2>Per Model</h2>
							<p>Cumulative token spend and cost per AI model used.</p>
						</div>
					</div>
					<?php if ( empty( $model_totals ) ) : ?>
						<p class="importonbridge-empty-state">No usage yet — import a product first.</p>
					<?php else : ?>
					<div class="importonbridge-table-wrap">
						<table class="widefat striped importonbridge-table">
							<thead>
								<tr>
									<th>Model</th>
									<th>Provider</th>
									<th style="text-align:right;">Input</th>
									<th style="text-align:right;">Output</th>
									<th style="text-align:right;">Calls</th>
									<th style="text-align:right;">Cost</th>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $model_totals as $mt ) : ?>
								<tr>
									<td><strong><?php echo esc_html( $mt['model'] ); ?></strong></td>
									<td><span class="importonbridge-status-pill importonbridge-status-pill--neutral"><?php echo esc_html( $mt['provider'] ); ?></span></td>
									<td style="text-align:right;"><?php echo esc_html( number_format( (int) $mt['total_input'] ) ); ?></td>
									<td style="text-align:right;"><?php echo esc_html( number_format( (int) $mt['total_output'] ) ); ?></td>
									<td style="text-align:right;"><?php echo (int) $mt['calls']; ?></td>
									<td style="text-align:right;font-weight:600;"><?php echo esc_html( $fmt_cost( $mt['total_cost'] ) ); ?></td>
								</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
					<?php endif; ?>
				</div>

				<div class="importonbridge-card importonbridge-card--section importonbridge-card--recent">
					<div class="importonbridge-card-head">
						<div>
							<h2>Per Product Log</h2>
							<p>Most recent 200 product imports with token and cost breakdown.</p>
						</div>
						<form method="post" style="margin:0;flex-shrink:0;">
							<?php wp_nonce_field( 'importonbridge_clear_usage_action', 'importonbridge_clear_usage_nonce' ); ?>
							<button type="submit" name="importonbridge_clear_usage" value="1" class="importonbridge-ghost-btn" onclick="return confirm('Clear all usage data? This cannot be undone.');">Clear Log</button>
						</form>
					</div>
					<?php if ( empty( $rows ) ) : ?>
						<p class="importonbridge-empty-state">No product usage logged yet.</p>
					<?php else : ?>
					<div class="importonbridge-table-wrap importonbridge-table-wrap--recent">
						<table class="widefat striped importonbridge-table importonbridge-run-table">
							<thead>
								<tr>
									<th>Product</th>
									<th>Model</th>
									<th style="text-align:right;">In tok</th>
									<th style="text-align:right;">Out tok</th>
									<th style="text-align:right;">Cost</th>
									<th>Date</th>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $rows as $row ) : ?>
								<tr>
									<td>
										<?php if ( (int) $row['product_id'] > 0 ) : ?>
											<a href="<?php echo esc_url( (string) get_edit_post_link( (int) $row['product_id'] ) ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $row['product_title'] ?: 'Product #' . $row['product_id'] ); ?></a>
										<?php else : ?>
											<?php echo esc_html( $row['product_title'] ?: '—' ); ?>
										<?php endif; ?>
									</td>
									<td><span class="importonbridge-muted"><?php echo esc_html( $row['model'] ); ?></span></td>
									<td style="text-align:right;"><?php echo esc_html( number_format( (int) $row['input_tok'] ) ); ?></td>
									<td style="text-align:right;"><?php echo esc_html( number_format( (int) $row['output_tok'] ) ); ?></td>
									<td style="text-align:right;font-weight:600;"><?php echo esc_html( $fmt_cost( $row['cost'] ) ); ?></td>
									<td><span class="importonbridge-muted"><?php echo esc_html( $row['last_run'] ); ?></span></td>
								</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
					<?php endif; ?>
				</div>

			</div>
		</div>
		<?php
	}

	public static function ajax_auto_apppass(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'Unauthorized.' ) );
		}
		if ( ! class_exists( 'WP_Application_Passwords' ) ) {
			wp_send_json_error( array( 'message' => 'Application Passwords not available.' ) );
		}

		$current_user = wp_get_current_user();
		$pw_name      = 'Importon Bridge';

		$existing = (array) WP_Application_Passwords::get_user_application_passwords( $current_user->ID );
		foreach ( $existing as $ap ) {
			if ( isset( $ap['name'] ) && $ap['name'] === $pw_name && isset( $ap['uuid'] ) ) {
				WP_Application_Passwords::delete_application_password( $current_user->ID, $ap['uuid'] );
			}
		}

		$result = WP_Application_Passwords::create_new_application_password( $current_user->ID, array( 'name' => $pw_name ) );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		$plain = $result[0];
		update_user_meta( $current_user->ID, 'importonbridge_creds', array(
			'password' => $plain,
			'username' => $current_user->user_login,
			'base_url' => home_url( '/' ),
		) );

		wp_send_json_success( array(
			'password' => $plain,
			'username' => $current_user->user_login,
			'baseUrl'  => home_url( '/' ),
		) );
	}
}
