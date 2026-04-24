-- Stored Procedures for Charge Calculation and Comparison
-- Target: MySQL Database

DELIMITER //

-- =============================================
-- DATABASE: masters
-- =============================================
USE masters //

DROP PROCEDURE IF EXISTS masters.sp_get_windmill_capacity //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_windmill_capacity(IN p_id INT)
BEGIN
    SELECT mc.capacity
    FROM masters.master_windmill mw
    JOIN masters.master_capacity mc 
        ON mw.capacity_mw_id = mc.id
    WHERE mw.id = p_id;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_charges_master_data //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_charges_master_data()
BEGIN
    SELECT 
        id,
        charge_code,
        charge_name,
        cost
    FROM masters.master_consumption_chargers
    WHERE energy_type = 'windmill'
    ORDER BY charge_code;
END //

DROP PROCEDURE IF EXISTS masters.sp_delete_charge_calculation //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_delete_charge_calculation(
    IN p_windmill_id INT,
    IN p_month INT,
    IN p_year INT
)
BEGIN
    DELETE FROM masters.charge_calculation
    WHERE windmill_id = p_windmill_id
    AND month = p_month
    AND year = p_year;
END //

DROP PROCEDURE IF EXISTS masters.sp_insert_charge_calculation //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_insert_charge_calculation(
    IN p_windmill_id INT,
    IN p_month INT,
    IN p_year INT,
    IN p_charge_id INT,
    IN p_calculated_value DECIMAL(18,2),
    IN p_calculation TEXT
)
BEGIN
    INSERT INTO masters.charge_calculation(
        windmill_id,
        month,
        year,
        charge_id,
        calculated_value,
        calculation
    )
    VALUES (
        p_windmill_id,
        p_month,
        p_year,
        p_charge_id,
        p_calculated_value,
        p_calculation
    );
END //

DROP PROCEDURE IF EXISTS masters.sp_update_charge_calculation_value //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_update_charge_calculation_value(
    IN p_val DECIMAL(18,2),
    IN p_windmill_id INT,
    IN p_month INT,
    IN p_year INT,
    IN p_charge_id INT
)
BEGIN
    UPDATE masters.charge_calculation 
    SET calculated_value = p_val 
    WHERE windmill_id = p_windmill_id 
      AND month = p_month 
      AND year = p_year 
      AND charge_id = p_charge_id;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_calculated_charges //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_calculated_charges(
    IN p_windmill_id INT,
    IN p_month INT,
    IN p_year INT
)
BEGIN
    SELECT charge_id, calculated_value, calculation 
    FROM masters.charge_calculation 
    WHERE windmill_id = p_windmill_id 
      AND month = p_month 
      AND year = p_year;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_charge_names //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_charge_names()
BEGIN
    SELECT id, charge_name FROM masters.master_consumption_chargers;
END //


-- =============================================
-- DATABASE: windmill
-- =============================================
USE windmill //

DROP PROCEDURE IF EXISTS windmill.sp_get_eb_statement_info //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_eb_statement_info(IN p_id INT)
BEGIN
    SELECT windmill_id, month, year FROM windmill.eb_statements WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_get_eb_solar_info //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_get_eb_solar_info(IN p_id INT)
BEGIN
    SELECT solar_id, month, year FROM solar.eb_statement_solar WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_get_solar_units //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_get_solar_units(
    IN p_solar_id INT,
    IN p_month INT,
    IN p_year INT
)
BEGIN
    SELECT SUM(net_unit) 
    FROM solar.eb_statement_solar_details 
    WHERE eb_header_id = (
        SELECT id FROM solar.eb_statement_solar 
        WHERE solar_id = p_solar_id AND month = p_month AND year = p_year 
        LIMIT 1
    );
END //

DROP PROCEDURE IF EXISTS solar.sp_delete_solar_charge_calculation //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_delete_solar_charge_calculation(
    IN p_solar_id INT,
    IN p_month INT,
    IN p_year INT
)
BEGIN
    DELETE FROM solar.charge_calculation 
    WHERE solar_id = p_solar_id AND month = p_month AND year = p_year;
END //

DROP PROCEDURE IF EXISTS solar.sp_insert_solar_charge_calculation //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_insert_solar_charge_calculation(
    IN p_solar_id INT,
    IN p_month INT,
    IN p_year INT,
    IN p_charge_id INT,
    IN p_value DECIMAL(18,2),
    IN p_calculation TEXT
)
BEGIN
    INSERT INTO solar.charge_calculation (solar_id, month, year, charge_id, value, calculation)
    VALUES (p_solar_id, p_month, p_year, p_charge_id, p_value, p_calculation);
END //

DROP PROCEDURE IF EXISTS solar.sp_update_solar_charge_calculation_value //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_update_solar_charge_calculation_value(
    IN p_value DECIMAL(18,2),
    IN p_solar_id INT,
    IN p_month INT,
    IN p_year INT,
    IN p_charge_id INT
)
BEGIN
    UPDATE solar.charge_calculation 
    SET value = p_value 
    WHERE solar_id = p_solar_id AND month = p_month AND year = p_year AND charge_id = p_charge_id;
END //

DROP PROCEDURE IF EXISTS solar.sp_get_solar_calculated_charges //
CREATE DEFINER=`root`@`localhost` PROCEDURE solar.sp_get_solar_calculated_charges(
    IN p_solar_id INT,
    IN p_month INT,
    IN p_year INT
)
BEGIN
    SELECT charge_id, value, calculation 
    FROM solar.charge_calculation 
    WHERE solar_id = p_solar_id AND month = p_month AND year = p_year;
END //

DROP PROCEDURE IF EXISTS masters.sp_get_charge_code_by_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE masters.sp_get_charge_code_by_id(IN p_id INT)
BEGIN
    SELECT charge_code FROM masters.master_consumption_chargers WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS windmill.sp_get_actuals_pdf //
CREATE DEFINER=`root`@`localhost` PROCEDURE windmill.sp_get_actuals_pdf(
    IN p_client_eb_id INT
)
BEGIN
    SELECT 
        mc.customer_name,
        cs.service_number AS sc_number,
        a.actual_month,
        a.actual_year,
        a.energy_number AS windmill,
        a.calculated_wheeling_value AS wheeling_charges,

        -- ✅ Total
        t.total_wheeling,

        -- ✅ SGT (Retrieved from masters.master_consumption_chargers code C011)
        c.SGT_constant AS sgt_constant,

        -- ✅ Tax (CORRECT CALCULATION)
        (t.total_wheeling * c.SGT_constant) AS self_generation_tax

    FROM windmill.actual a

    -- ✅ Total subquery
    CROSS JOIN (
        SELECT IFNULL(SUM(calculated_wheeling_value), 0) AS total_wheeling
        FROM actual
        WHERE client_eb_id = p_client_eb_id
    ) t

    -- ✅ Configuration (Now fetched from chargers master C011 cost column)
    CROSS JOIN (
        SELECT IFNULL(cost, 0) AS SGT_constant
        FROM masters.master_consumption_chargers
        WHERE charge_code = 'C011'
        LIMIT 1
    ) c

    LEFT JOIN masters.master_customers mc 
        ON a.customer_id = mc.id

    LEFT JOIN masters.customer_service cs 
        ON a.sc_id = cs.id

    WHERE a.client_eb_id = p_client_eb_id
    ORDER BY a.energy_number;
END //

DELIMITER ;
