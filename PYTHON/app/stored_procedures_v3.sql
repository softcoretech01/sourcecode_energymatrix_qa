-- Stored Procedures for Energy Matrix qa - Part 3
-- Target: MySQL Database

DELIMITER //

-- =============================================
-- DATABASE: masters
-- =============================================
USE masters //

DROP PROCEDURE IF EXISTS masters.sp_get_windmill_number_by_id_or_val //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_windmill_number_by_id_or_val(IN p_val VARCHAR(255))
BEGIN
    IF p_val REGEXP '^[0-9]+$' THEN
        SELECT windmill_number FROM masters.master_windmill WHERE id = CAST(p_val AS UNSIGNED);
    ELSE
        SELECT windmill_number FROM masters.master_windmill WHERE windmill_number = p_val COLLATE utf8mb4_unicode_ci;
    END IF;
END //

DROP PROCEDURE IF EXISTS masters.sp_mapping_charge_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_mapping_charge_id(IN p_name VARCHAR(255), IN p_code VARCHAR(100))
BEGIN
    -- 1) Try match by charge description
    SELECT id FROM masters.master_consumption_chargers 
    WHERE TRIM(LOWER(charge_description)) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', TRIM(LOWER(p_name)), '%') COLLATE utf8mb4_unicode_ci
    LIMIT 1;
END //

DROP PROCEDURE IF EXISTS masters.sp_mapping_charge_id_by_code //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_mapping_charge_id_by_code(IN p_code VARCHAR(100))
BEGIN
    SELECT id FROM masters.master_consumption_chargers 
    WHERE TRIM(LOWER(charge_code)) COLLATE utf8mb4_unicode_ci = TRIM(LOWER(p_code)) COLLATE utf8mb4_unicode_ci
    LIMIT 1;
END //

DROP PROCEDURE IF EXISTS masters.sp_mapping_charge_id_fallback //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_mapping_charge_id_fallback(IN p_name VARCHAR(255))
BEGIN
    SELECT id FROM masters.master_consumption_chargers 
    WHERE (TRIM(LOWER(charge_name)) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', TRIM(LOWER(p_name)), '%') COLLATE utf8mb4_unicode_ci)
       OR (TRIM(LOWER(charge_code)) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', TRIM(LOWER(p_name)), '%') COLLATE utf8mb4_unicode_ci)
    LIMIT 1;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_solar_windmill_dropdown //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_solar_windmill_dropdown()
BEGIN
    SELECT id, windmill_number 
    FROM masters.master_windmill 
    WHERE LOWER(type) = 'solar' AND is_submitted = 1 
    ORDER BY windmill_number;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_windmill_dropdown_standard //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_windmill_dropdown_standard()
BEGIN
    SELECT id, windmill_number 
    FROM masters.master_windmill 
    WHERE LOWER(type) = 'windmill' AND is_submitted = 1 
    ORDER BY windmill_number;
END //

DROP PROCEDURE IF EXISTS masters.sp_check_configuration_row_exists //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_check_configuration_row_exists(IN p_id INT)
BEGIN
    SELECT id FROM masters.configuration WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_windmill_list_dropdown_for_gen //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_windmill_list_dropdown_for_gen()
BEGIN
    SELECT id, windmill_number
    FROM masters.master_windmill
    WHERE status = 'Active' AND is_submitted = 1;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_consumption_charges //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_consumption_charges()
BEGIN
    SELECT charge_code, charge_name 
    FROM masters.master_consumption_chargers 
    WHERE status = 1;
END //


-- =============================================
-- DATABASE: solar
-- =============================================
USE solar //


DROP PROCEDURE IF EXISTS solar.sp_check_eb_solar_duplicate //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_check_eb_solar_duplicate(IN p_solar_id VARCHAR(255), IN p_month VARCHAR(50), IN p_year INT)
BEGIN
    SELECT id FROM solar.eb_statement_solar 
    WHERE solar_id = p_solar_id AND month = p_month COLLATE utf8mb4_unicode_ci AND year = p_year;
END //

DROP PROCEDURE IF EXISTS solar.sp_create_eb_solar_header //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_create_eb_solar_header(
    IN p_solar_id VARCHAR(255),
    IN p_month VARCHAR(50),
    IN p_year INT,
    IN p_path VARCHAR(500),
    IN p_user_id INT
)
BEGIN
    INSERT INTO solar.eb_statement_solar (solar_id, month, year, pdf_file_path, is_submitted, created_by, created_at)
    VALUES (p_solar_id, p_month, p_year, p_path, 0, p_user_id, NOW());
    SELECT LAST_INSERT_ID() AS id;
END //

DROP PROCEDURE IF EXISTS solar.sp_update_eb_solar_year //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_update_eb_solar_year(IN p_id INT, IN p_year INT)
BEGIN
    UPDATE solar.eb_statement_solar SET year = p_year WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_delete_eb_solar_header //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_delete_eb_solar_header(IN p_id INT)
BEGIN
    DELETE FROM solar.eb_statement_solar_details WHERE eb_header_id = p_id;
    DELETE FROM solar.eb_statement_solar_applicable_charges WHERE eb_header_id = p_id;
    DELETE FROM solar.eb_statement_solar WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_search_eb_solar //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_search_eb_solar(
    IN p_solar_id VARCHAR(255),
    IN p_year INT,
    IN p_month VARCHAR(50),
    IN p_status VARCHAR(50),
    IN p_keyword VARCHAR(255),
    IN p_limit INT,
    IN p_offset INT
)
BEGIN
    -- Result Set 1: Total Count
    SELECT COUNT(*) as total
    FROM solar.eb_statement_solar es
    WHERE (p_solar_id IS NULL OR es.solar_id = p_solar_id)
      AND (p_year IS NULL OR es.year = p_year)
      AND (p_month IS NULL OR es.month = p_month COLLATE utf8mb4_unicode_ci)
      AND (p_keyword IS NULL OR es.pdf_file_path LIKE CONCAT('%', p_keyword, '%') COLLATE utf8mb4_unicode_ci);

    -- Result Set 2: Paginated Data
    SELECT es.id, es.solar_id, es.month, es.year, es.pdf_file_path, es.is_submitted, 
           COALESCE(es.modified_at, es.created_at) as submitted_time, u.name as submitted_by
    FROM solar.eb_statement_solar es
    LEFT JOIN masters.users u ON es.created_by = u.id
    WHERE (p_solar_id IS NULL OR es.solar_id = p_solar_id)
      AND (p_year IS NULL OR es.year = p_year)
      AND (p_month IS NULL OR es.month = p_month COLLATE utf8mb4_unicode_ci)
      AND (p_keyword IS NULL OR es.pdf_file_path LIKE CONCAT('%', p_keyword, '%') COLLATE utf8mb4_unicode_ci)
    ORDER BY submitted_time DESC
    LIMIT p_limit OFFSET p_offset;
END //

DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_details //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_get_eb_solar_details(IN p_header_id INT)
BEGIN
    SELECT id, company_name, solar_id, slots, net_unit 
    FROM solar.eb_statement_solar_details 
    WHERE eb_header_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_charges //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_get_eb_solar_charges(IN p_header_id INT)
BEGIN
    SELECT c.id, c.charge_id, c.total_charge, m.charge_description, m.charge_code
    FROM solar.eb_statement_solar_applicable_charges c
    LEFT JOIN masters.master_consumption_chargers m ON c.charge_id = m.id
    WHERE c.eb_header_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_metadata_by_filename //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_get_eb_solar_metadata_by_filename(IN p_filename VARCHAR(255))
BEGIN
    SELECT id, month, year 
    FROM solar.eb_statement_solar 
    WHERE pdf_file_path LIKE CONCAT('%', p_filename, '%') 
    ORDER BY created_at DESC 
    LIMIT 1;
END //


-- =============================================
-- DATABASE: windmill
-- =============================================
USE windmill //

DROP PROCEDURE IF EXISTS windmill.sp_create_eb_statement_header //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_create_eb_statement_header(
    IN p_windmill_id BIGINT,
    IN p_month VARCHAR(50),
    IN p_year INT,
    IN p_path VARCHAR(500),
    IN p_user_id INT
)
BEGIN
    INSERT INTO windmill.eb_statements (windmill_id, month, year, pdf_file_path, is_submitted, created_by, created_at, modified_at)
    VALUES (p_windmill_id, p_month, p_year, p_path, 0, p_user_id, NOW(), NOW());
    SELECT LAST_INSERT_ID() AS id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_check_eb_statement_duplicate //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_check_eb_statement_duplicate(
    IN p_windmill_id BIGINT, 
    IN p_month VARCHAR(50), 
    IN p_year INT
)
BEGIN
    SELECT id FROM windmill.eb_statements 
    WHERE windmill_id = p_windmill_id 
      AND month = p_month COLLATE utf8mb4_unicode_ci
      AND year = p_year;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_list //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_list(
    IN p_windmill_number VARCHAR(100),
    IN p_year INT,
    IN p_month VARCHAR(50)
)
BEGIN
    SELECT es.id, es.month, es.year, mw.windmill_number, es.pdf_file_path, es.is_submitted, 
           COALESCE(es.modified_at, es.created_at) as submitted_time, u.name as submitted_by
    FROM windmill.eb_statements es
    LEFT JOIN masters.master_windmill mw ON es.windmill_id = mw.id
    LEFT JOIN masters.users u ON es.created_by = u.id
    WHERE (p_windmill_number IS NULL OR mw.windmill_number = p_windmill_number COLLATE utf8mb4_unicode_ci)
      AND (p_year IS NULL OR es.year = p_year)
      AND (p_month IS NULL OR es.month = p_month COLLATE utf8mb4_unicode_ci)
    ORDER BY submitted_time DESC;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_metadata_by_filename //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_metadata_by_filename(IN p_filename VARCHAR(255))
BEGIN
    SELECT id, month, year FROM windmill.eb_statements WHERE pdf_file_path LIKE CONCAT('%', p_filename, '%');
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_details_slots //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_details_slots(IN p_header_id INT)
BEGIN
    SELECT slots, net_unit, banking_units 
    FROM windmill.eb_statements_details 
    WHERE eb_header_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_total_banking //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_total_banking(IN p_header_id INT)
BEGIN
    SELECT total_banking_units FROM windmill.eb_statements_total_banking_units WHERE eb_header_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_charges //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_charges(IN p_header_id INT)
BEGIN
    SELECT a.charge_id, a.charge_description, a.total_charge, m.charge_name, m.charge_code
    FROM windmill.eb_statements_applicable_charges a
    LEFT JOIN masters.master_consumption_chargers m ON a.charge_id = m.id
    WHERE a.eb_header_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_file_path_for_delete //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_file_path_for_delete(IN p_id INT)
BEGIN
    SELECT pdf_file_path FROM windmill.eb_statements WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_by_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_by_id(IN p_id INT)
BEGIN
    SELECT id, month, windmill_id, pdf_file_path, is_submitted FROM windmill.eb_statements WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_update_eb_statement_header //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_update_eb_statement_header(
    IN p_id INT,
    IN p_windmill_id BIGINT,
    IN p_month VARCHAR(50),
    IN p_path VARCHAR(500)
)
BEGIN
    UPDATE windmill.eb_statements 
    SET windmill_id = p_windmill_id, month = p_month, pdf_file_path = p_path, modified_at = NOW() 
    WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_clear_eb_statement_child_records //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_clear_eb_statement_child_records(IN p_header_id INT)
BEGIN
    DELETE FROM windmill.eb_statements_details WHERE eb_header_id = p_header_id;
    DELETE FROM windmill.eb_statements_applicable_charges WHERE eb_header_id = p_header_id;
    DELETE FROM windmill.eb_statements_total_banking_units WHERE eb_header_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_insert_eb_statement_detail //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_insert_eb_statement_detail(
    IN p_header_id INT,
    IN p_company_name VARCHAR(255),
    IN p_windmill_id BIGINT,
    IN p_slot INT,
    IN p_net_unit DECIMAL(18,4),
    IN p_banking_units DECIMAL(18,4),
    IN p_user_id INT
)
BEGIN
    INSERT INTO windmill.eb_statements_details 
    (eb_header_id, company_name, windmill_id, slots, net_unit, banking_units, created_by)
    VALUES (p_header_id, p_company_name, p_windmill_id, p_slot, p_net_unit, p_banking_units, p_user_id);
END //

DROP PROCEDURE IF EXISTS windmill.sp_insert_eb_statement_total_banking //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_insert_eb_statement_total_banking(
    IN p_header_id INT,
    IN p_units DECIMAL(18,4),
    IN p_user_id INT
)
BEGIN
    INSERT INTO windmill.eb_statements_total_banking_units (eb_header_id, total_banking_units, created_by)
    VALUES (p_header_id, p_units, p_user_id);
END //

DROP PROCEDURE IF EXISTS windmill.sp_insert_eb_statement_charge //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_insert_eb_statement_charge(
    IN p_header_id INT,
    IN p_charge_id INT,
    IN p_description VARCHAR(255),
    IN p_amount DECIMAL(18,4),
    IN p_user_id INT
)
BEGIN
    INSERT INTO windmill.eb_statements_applicable_charges (eb_header_id, charge_id, charge_description, total_charge, created_by)
    VALUES (p_header_id, p_charge_id, p_description, p_amount, p_user_id);
END //

DROP PROCEDURE IF EXISTS windmill.insert_eb_bill_adjustment_charge //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.insert_eb_bill_adjustment_charge(
    IN p_eb_bill_header_id INT,
    IN p_energy_number VARCHAR(50),
    IN p_c001 DECIMAL(12,2),
    IN p_c002 DECIMAL(12,2),
    IN p_c003 DECIMAL(12,2),
    IN p_c004 DECIMAL(12,2),
    IN p_c005 DECIMAL(12,2),
    IN p_c006 DECIMAL(12,2),  
    IN p_c007 DECIMAL(12,2),
    IN p_c008 DECIMAL(12,2),
    IN p_c010 DECIMAL(12,2),
    IN p_wheeling_charges DECIMAL(12,2),
    IN p_created_by INT,
    IN p_modified_by INT
)
BEGIN
    DECLARE v_calculated_wheeling DECIMAL(12,2);
    DECLARE v_bill_year INT;
    DECLARE v_bill_month INT;
    DECLARE v_customer_id INT;
    DECLARE v_sc_id INT;
    DECLARE v_whlc_cost DECIMAL(18,4);
    DECLARE v_whlc_discount DECIMAL(18,4);
    DECLARE v_whlc_factor DECIMAL(18,4) DEFAULT 0.54; -- Fallback to 0.54

    -- Handler
    DECLARE CONTINUE HANDLER FOR NOT FOUND 
    SET v_bill_year = NULL, v_bill_month = NULL, 
        v_customer_id = NULL, v_sc_id = NULL;

    -- 1. Get header/customer direct from eb_bill
    SELECT bill_year, bill_month, customer_id, sc_id
    INTO v_bill_year, v_bill_month, v_customer_id, v_sc_id
    FROM eb_bill
    WHERE id = p_eb_bill_header_id
    LIMIT 1;

    -- 2. Get Wheeling Charges Configuration from Masters
    SELECT cost, discount_charges 
    INTO v_whlc_cost, v_whlc_discount
    FROM masters.master_consumption_chargers
    WHERE REPLACE(LOWER(charge_name), ' ', '') = 'wheelingcharges'
    LIMIT 1;

    -- 3. Calculate dynamic factor: (cost * discount / 100)
    -- e.g. (1.040 * 50 / 100) = 0.52
    IF v_whlc_cost IS NOT NULL AND v_whlc_discount IS NOT NULL THEN
        SET v_whlc_factor = v_whlc_cost * (v_whlc_discount / 100.0);
    END IF;

    -- Prevent division by zero
    IF v_whlc_factor = 0 THEN SET v_whlc_factor = 0.54; END IF;

    -- 4. Calculate actual wheeling value
    SET v_calculated_wheeling = ROUND(COALESCE(p_wheeling_charges,0) / v_whlc_factor, 2);

    -- 5. Insert adjustment
    INSERT INTO eb_bill_adjustment_charges(
        eb_bill_header_id,
        energy_number,
        c001,c002,c003,c004,c005,c006,c007,c008,c010,
        wheeling_charges,
        created_by,created_at,modified_by,modified_at
    ) VALUES (
        p_eb_bill_header_id,
        p_energy_number COLLATE utf8mb4_unicode_ci,
        COALESCE(p_c001,0),
        COALESCE(p_c002,0),
        COALESCE(p_c003,0),
        COALESCE(p_c004,0),
        COALESCE(p_c005,0),
        COALESCE(p_c006,0),
        COALESCE(p_c007,0),
        COALESCE(p_c008,0),
        COALESCE(p_c010,0),
        COALESCE(p_wheeling_charges,0),
        p_created_by,NOW(),p_modified_by,NOW()
    );

    -- 6. SAFE insert into actual
    IF v_bill_year IS NOT NULL 
       AND v_bill_month IS NOT NULL
       AND v_customer_id IS NOT NULL
       AND v_sc_id IS NOT NULL THEN

        IF NOT EXISTS (
            SELECT 1 FROM actual
            WHERE client_eb_id = p_eb_bill_header_id
            AND energy_number = p_energy_number COLLATE utf8mb4_unicode_ci
            AND actual_year = v_bill_year
            AND actual_month = v_bill_month
        ) THEN

            INSERT INTO actual(
                client_eb_id,
                actual_year,
                actual_month,
                customer_id,
                sc_id,
                energy_number,
                calculated_wheeling_value
            ) VALUES (
                p_eb_bill_header_id,
                v_bill_year,
                v_bill_month,
                v_customer_id,
                v_sc_id,
                p_energy_number COLLATE utf8mb4_unicode_ci,
                v_calculated_wheeling
            );

        END IF;

    END IF;

    SELECT LAST_INSERT_ID() AS inserted_id;

END //

DROP PROCEDURE IF EXISTS windmill.sp_mark_eb_statement_submitted //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_mark_eb_statement_submitted(IN p_id INT)
BEGIN
    UPDATE windmill.eb_statements SET is_submitted = 1, modified_at = NOW() WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS windmill.update_windmill_daily_transaction_submitted //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_update_windmill_daily_transaction_submitted(IN p_id INT, IN p_val INT)
BEGIN
    UPDATE windmill.windmill_daily_transaction SET is_submitted = p_val WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS windmill.get_eb_bill_list //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.get_eb_bill_list(
    IN p_customer_id INT,
    IN p_year INT,
    IN p_month INT
)
BEGIN
    SELECT 
        e.id, 
        e.bill_month, 
        e.bill_year, 
        mc.customer_name, 
        cs.service_number,
        e.pdf_file_path, 
        e.is_submitted, 
        e.created_at, 
        u.name as created_by
    FROM eb_bill e
    JOIN masters.master_customers mc ON e.customer_id = mc.id
    JOIN masters.customer_service cs ON e.sc_id = cs.id
    LEFT JOIN masters.users u ON e.created_by = u.id
    WHERE (p_customer_id IS NULL OR e.customer_id = p_customer_id)
      AND (p_year IS NULL OR e.bill_year = p_year)
      AND (p_month IS NULL OR e.bill_month = p_month)
    ORDER BY e.created_at DESC;
END //

DELIMITER ;
