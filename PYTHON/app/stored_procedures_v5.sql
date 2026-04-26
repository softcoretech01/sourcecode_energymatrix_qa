-- Stored Procedures for Energy Matrix qa - Part 5
-- Target: MySQL Database

DELIMITER //

-- =============================================
-- DATABASE: masters
-- =============================================
USE masters //

-- 1. Get active and posted windmills
DROP PROCEDURE IF EXISTS masters.sp_get_active_posted_windmills //
CREATE DEFINER=`root`@`%` PROCEDURE masters.sp_get_active_posted_windmills()
BEGIN
    SELECT * FROM masters.master_windmill WHERE status = 'Active' AND is_submitted = 1 ORDER BY windmill_number;
END //

-- 2. Get customers and service numbers for allotment
DROP PROCEDURE IF EXISTS masters.sp_get_customers_for_energy_allotment //
CREATE DEFINER=`root`@`%` PROCEDURE masters.sp_get_customers_for_energy_allotment()
BEGIN
    SELECT 
        mc.id, 
        mc.customer_name, 
        cs.id as service_id, 
        cs.service_number
    FROM masters.master_customers mc
    JOIN masters.customer_service cs ON mc.id = cs.customer_id
    WHERE mc.status = 1 AND cs.status = 1
    ORDER BY mc.customer_name, cs.service_number;
END //

-- 3. Get windmill numbers by a list of IDs (Comma separated string)
DROP PROCEDURE IF EXISTS masters.sp_get_windmill_numbers_by_ids //
CREATE DEFINER=`root`@`%` PROCEDURE masters.sp_get_windmill_numbers_by_ids(IN p_ids TEXT)
BEGIN
    IF p_ids IS NOT NULL AND p_ids != '' THEN
        SET @sql = CONCAT('SELECT id, windmill_number FROM masters.master_windmill WHERE id IN (', p_ids, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

-- 4. Get windmill number by ID or Number (Simplified)
DROP PROCEDURE IF EXISTS masters.sp_get_windmill_number_by_id_only //
CREATE DEFINER=`root`@`%` PROCEDURE masters.sp_get_windmill_number_by_id_only(IN p_id INT)
BEGIN
    SELECT windmill_number FROM masters.master_windmill WHERE id = p_id;
END //

-- 5. Get windmill number by Number only
DROP PROCEDURE IF EXISTS masters.sp_get_windmill_id_by_number //
CREATE DEFINER=`root`@`%` PROCEDURE masters.sp_get_windmill_id_by_number(IN p_number VARCHAR(100))
BEGIN
    SELECT id FROM masters.master_windmill WHERE windmill_number = p_number;
END //

-- Advanced charge mapping
DROP PROCEDURE IF EXISTS masters.sp_map_charge_id_advanced //
CREATE DEFINER=`root`@`%` PROCEDURE masters.sp_map_charge_id_advanced(IN p_name VARCHAR(255), IN p_code VARCHAR(100))
BEGIN
    DECLARE v_id INT;
    DECLARE v_desc VARCHAR(255);

    -- 1) Exact match on description
    SELECT id, charge_description INTO v_id, v_desc 
    FROM masters.master_consumption_chargers
    WHERE TRIM(LOWER(charge_description)) = TRIM(LOWER(p_name))
    ORDER BY (CASE WHEN TRIM(LOWER(energy_type)) = 'solar' THEN 0 ELSE 1 END), id LIMIT 1;

    -- 2) Code match if no id yet
    IF v_id IS NULL AND p_code IS NOT NULL AND p_code != '' THEN
        SELECT id, charge_description INTO v_id, v_desc 
        FROM masters.master_consumption_chargers
        WHERE TRIM(LOWER(charge_code)) = TRIM(LOWER(p_code))
        ORDER BY (CASE WHEN TRIM(LOWER(energy_type)) = 'solar' THEN 0 ELSE 1 END), id LIMIT 1;
    END IF;

    -- 3) LIKE match if no id yet
    IF v_id IS NULL THEN
        SELECT id, charge_description INTO v_id, v_desc 
        FROM masters.master_consumption_chargers
        WHERE TRIM(LOWER(charge_description)) LIKE CONCAT('%', TRIM(LOWER(p_name)), '%')
        ORDER BY (CASE WHEN TRIM(LOWER(energy_type)) = 'solar' THEN 0 ELSE 1 END), CHAR_LENGTH(charge_description) DESC, id LIMIT 1;
    END IF;

    SELECT v_id as id, v_desc as charge_description;
END //


-- =============================================
-- DATABASE: windmill
-- =============================================
USE windmill //

-- 6. Get EB applicable charges summary (Windmill + Solar)
DROP PROCEDURE IF EXISTS windmill.sp_get_eb_applicable_charges_summary //
CREATE DEFINER=`root`@`%` PROCEDURE windmill.sp_get_eb_applicable_charges_summary(IN p_year INT, IN p_month VARCHAR(50))
BEGIN
    DECLARE v_month_num INT;
    DECLARE v_month_name VARCHAR(50);
    
    -- Determine numeric and name versions of the month
    IF p_month REGEXP '^[0-9]+$' THEN
        SET v_month_num = CAST(p_month AS UNSIGNED);
        SET v_month_name = CASE v_month_num
            WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March' WHEN 4 THEN 'April'
            WHEN 5 THEN 'May' WHEN 6 THEN 'June' WHEN 7 THEN 'July' WHEN 8 THEN 'August'
            WHEN 9 THEN 'September' WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
            ELSE NULL
        END;
    ELSE
        SET v_month_name = p_month;
        SET v_month_num = CASE LOWER(p_month)
            WHEN 'january' THEN 1 WHEN 'february' THEN 2 WHEN 'march' THEN 3 WHEN 'april' THEN 4
            WHEN 'may' THEN 5 WHEN 'june' THEN 6 WHEN 'july' THEN 7 WHEN 'august' THEN 8
            WHEN 'september' THEN 9 WHEN 'october' THEN 10 WHEN 'november' THEN 11 WHEN 'december' THEN 12
            ELSE NULL
        END;
    END IF;

    -- Windmill Charges
    SELECT 
        mw.windmill_number,
        mcc.charge_code,
        ac.total_charge
    FROM windmill.eb_statements es
    JOIN masters.master_windmill mw ON es.windmill_id = mw.id
    JOIN windmill.eb_statements_applicable_charges ac ON es.id = ac.eb_header_id
    JOIN masters.master_consumption_chargers mcc ON ac.charge_id = mcc.id
    WHERE es.year = p_year 
      AND (es.month = v_month_name COLLATE utf8mb4_unicode_ci OR es.month = CAST(v_month_num AS CHAR) COLLATE utf8mb4_unicode_ci)
    
    UNION ALL
    
    -- Solar Charges
    SELECT 
        mw.windmill_number,
        mcc.charge_code,
        sc.total_charge
    FROM solar.eb_statement_solar es
    JOIN masters.master_windmill mw ON es.solar_id = mw.id
    JOIN solar.eb_statement_solar_applicable_charges sc ON es.id = sc.eb_header_id
    JOIN masters.master_consumption_chargers mcc ON sc.charge_id = mcc.id
    WHERE es.year = p_year 
      AND (es.month = v_month_name COLLATE utf8mb4_unicode_ci OR es.month = CAST(v_month_num AS CHAR) COLLATE utf8mb4_unicode_ci);
END //


-- 7. Get EB statement units summary (Windmill + Solar)
DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_summary_by_month //
CREATE DEFINER=`root`@`%` PROCEDURE windmill.sp_get_eb_statement_summary_by_month(IN p_year INT, IN p_month VARCHAR(50))
BEGIN
    -- This procedure fetches aggregated units from both Windmill and Solar databases.
    -- It handles both numeric month strings (e.g. '3') and name strings (e.g. 'March').
    
    DECLARE v_month_num INT;
    DECLARE v_month_name VARCHAR(50);
    -- Determine numeric and name versions of the month
    IF p_month REGEXP '^[0-9]+$' THEN
        SET v_month_num = CAST(p_month AS UNSIGNED);
        SET v_month_name = CASE v_month_num
            WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March' WHEN 4 THEN 'April'
            WHEN 5 THEN 'May' WHEN 6 THEN 'June' WHEN 7 THEN 'July' WHEN 8 THEN 'August'
            WHEN 9 THEN 'September' WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
            ELSE NULL
        END;
    ELSE
        SET v_month_name = p_month;
        SET v_month_num = CASE LOWER(p_month)
            WHEN 'january' THEN 1 WHEN 'february' THEN 2 WHEN 'march' THEN 3 WHEN 'april' THEN 4
            WHEN 'may' THEN 5 WHEN 'june' THEN 6 WHEN 'july' THEN 7 WHEN 'august' THEN 8
            WHEN 'september' THEN 9 WHEN 'october' THEN 10 WHEN 'november' THEN 11 WHEN 'december' THEN 12
            ELSE NULL
        END;
    END IF;

    -- Windmill Data
    SELECT 
        mw.windmill_number,
        esd.slots,
        esd.net_unit,
        esd.banking_units
    FROM windmill.eb_statements es
    JOIN masters.master_windmill mw ON es.windmill_id = mw.id
    JOIN windmill.eb_statements_details esd ON es.id = esd.eb_header_id
    WHERE es.year = p_year 
      AND (es.month = v_month_name COLLATE utf8mb4_unicode_ci OR es.month = CAST(v_month_num AS CHAR) COLLATE utf8mb4_unicode_ci)
    
    UNION ALL
    
    -- Solar Data
    SELECT 
        mw.windmill_number,
        esd.slots,
        esd.net_unit,
        0.0 as banking_units -- Solar doesn't typically have banking in this schema
    FROM solar.eb_statement_solar es
    JOIN masters.master_windmill mw ON es.solar_id = mw.id
    JOIN solar.eb_statement_solar_details esd ON es.id = esd.eb_header_id
    WHERE es.year = p_year 
      AND (es.month = v_month_name COLLATE utf8mb4_unicode_ci OR es.month = CAST(v_month_num AS CHAR) COLLATE utf8mb4_unicode_ci);
END //



-- =============================================
-- DATABASE: solar
-- =============================================
USE solar //

-- 8. Get solar applicable charges summary
DROP PROCEDURE IF EXISTS solar.sp_get_solar_applicable_charges_summary //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_get_solar_applicable_charges_summary(IN p_year INT, IN p_month VARCHAR(50))
BEGIN
    SELECT 
        mw.windmill_number,
        mcc.charge_code,
        sc.total_charge
    FROM solar.eb_statement_solar es
    JOIN masters.master_windmill mw ON es.solar_id = mw.id
    JOIN solar.eb_statement_solar_applicable_charges sc ON es.id = sc.eb_header_id
    JOIN masters.master_consumption_chargers mcc ON sc.charge_id = mcc.id
    WHERE es.year = p_year AND es.month = p_month COLLATE utf8mb4_unicode_ci;
END //

-- 9. Get solar record by filename (extended)
DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_by_filename_extended //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_get_eb_solar_by_filename_extended(IN p_filename VARCHAR(255))
BEGIN
    SELECT id, month, year, is_submitted 
    FROM solar.eb_statement_solar 
    WHERE pdf_file_path LIKE CONCAT('%', p_filename, '%') 
    ORDER BY created_at DESC 
    LIMIT 1;
END //

-- 10. Get solar record by ID (simple)
DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_by_id_simple //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_get_eb_solar_by_id_simple(IN p_id INT)
BEGIN
    SELECT id, month, year, is_submitted, pdf_file_path, solar_id FROM solar.eb_statement_solar WHERE id = p_id;
END //

-- 11. Clear solar details
DROP PROCEDURE IF EXISTS solar.sp_clear_eb_solar_details //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_clear_eb_solar_details(IN p_header_id INT)
BEGIN
    DELETE FROM solar.eb_statement_solar_details WHERE eb_header_id = p_header_id;
    DELETE FROM solar.eb_statement_solar_applicable_charges WHERE eb_header_id = p_header_id;
END //

-- 12. Insert solar detail record
DROP PROCEDURE IF EXISTS solar.sp_insert_eb_solar_detail //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_insert_eb_solar_detail(
    IN p_header_id INT, 
    IN p_company_name VARCHAR(255), 
    IN p_solar_id VARCHAR(255), 
    IN p_slots VARCHAR(50), 
    IN p_net_unit DECIMAL(18,4), 
    IN p_user_id INT
)
BEGIN
    INSERT INTO solar.eb_statement_solar_details (eb_header_id, company_name, solar_id, slots, net_unit, created_by, created_at)
    VALUES (p_header_id, p_company_name, p_solar_id, p_slots, p_net_unit, p_user_id, NOW());
END //

-- 13. Insert solar charge record
DROP PROCEDURE IF EXISTS solar.sp_insert_eb_solar_charge //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_insert_eb_solar_charge(
    IN p_header_id INT, 
    IN p_charge_id INT, 
    IN p_description VARCHAR(255),
    IN p_amount DECIMAL(18,4), 
    IN p_user_id INT
)
BEGIN
    INSERT INTO solar.eb_statement_solar_applicable_charges (eb_header_id, charge_id, charge_description, total_charge, created_by, created_at)
    VALUES (p_header_id, p_charge_id, p_description, p_amount, p_user_id, NOW());
END //

-- 14. Mark solar record as submitted
DROP PROCEDURE IF EXISTS solar.sp_submit_eb_solar //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_submit_eb_solar(IN p_header_id INT)
BEGIN
    UPDATE solar.eb_statement_solar SET is_submitted = 1, modified_at = NOW() WHERE id = p_header_id;
END //

-- 15. Get latest solar record by solar_id
DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_latest_by_solar_id //
CREATE DEFINER=`root`@`%` PROCEDURE solar.sp_get_eb_solar_latest_by_solar_id(IN p_solar_id VARCHAR(255))
BEGIN
    SELECT id, month, year FROM solar.eb_statement_solar WHERE solar_id = p_solar_id ORDER BY created_at DESC LIMIT 1;
END //

DELIMITER ;

DELIMITER ;
