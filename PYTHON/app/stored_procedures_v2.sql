-- Stored Procedures for Energy Matrix UAT
-- Target: MySQL Database

DELIMITER //

-- =============================================
-- DATABASE: masters
-- =============================================
USE masters //

-- CAPACITY ROUTES
DROP PROCEDURE IF EXISTS sp_update_capacity_val //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_update_capacity_val(IN p_id INT, IN p_capacity VARCHAR(255))
BEGIN
    UPDATE master_capacity SET capacity = p_capacity WHERE id = p_id;
END //

-- =============================================
-- CONSUMPTION ROUTES
-- =============================================

DROP PROCEDURE IF EXISTS sp_update_consumption_record //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_update_consumption_record(
    IN p_id INT,
    IN p_energy_type VARCHAR(255),
    IN p_charge_code VARCHAR(255),
    IN p_charge_name VARCHAR(255),
    IN p_cost DECIMAL(18,4),
    IN p_uom VARCHAR(50),
    IN p_type VARCHAR(50),
    IN p_charge_description TEXT,
    IN p_valid_upto DATE,
    IN p_discount_charges DECIMAL(18,4),
    IN p_status INT,
    IN p_is_submitted INT,
    IN p_modified_by INT
)
BEGIN
    UPDATE master_consumption_chargers SET
        energy_type = p_energy_type,
        charge_code = p_charge_code,
        charge_name = p_charge_name,
        cost = p_cost,
        uom = p_uom,
        type = p_type,
        charge_description = p_charge_description,
        valid_upto = p_valid_upto,
        discount_charges = p_discount_charges,
        status = p_status,
        is_submitted = p_is_submitted,
        modified_by = p_modified_by,
        modified_at = NOW()
    WHERE id = p_id;
END //


-- =============================================
-- CUSTOMER ROUTER
-- =============================================

DROP PROCEDURE IF EXISTS sp_update_customer_status //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_update_customer_status(IN p_id INT, IN p_status INT)
BEGIN
    UPDATE master_customers SET status = p_status WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS sp_check_customer_service_exists //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_customer_service_exists(IN p_customer_id INT)
BEGIN
    SELECT id FROM customer_service WHERE customer_id = p_customer_id LIMIT 1;
END //

DROP PROCEDURE IF EXISTS sp_check_customer_contact_exists //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_customer_contact_exists(IN p_customer_id INT)
BEGIN
    SELECT id FROM customer_contact WHERE customer_id = p_customer_id LIMIT 1;
END //

DROP PROCEDURE IF EXISTS sp_check_customer_agreed_exists //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_customer_agreed_exists(IN p_customer_id INT)
BEGIN
    SELECT id FROM customer_agreed WHERE customer_id = p_customer_id LIMIT 1;
END //

DROP PROCEDURE IF EXISTS sp_check_service_number_duplicate //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_service_number_duplicate(IN p_customer_id INT, IN p_service_number VARCHAR(255))
BEGIN
    SELECT id FROM customer_service WHERE customer_id = p_customer_id AND service_number = p_service_number;
END //

DROP PROCEDURE IF EXISTS sp_delete_customer_service //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_delete_customer_service(IN p_id INT, IN p_customer_id INT)
BEGIN
    DELETE FROM customer_service WHERE id = p_id AND customer_id = p_customer_id;
END //

DROP PROCEDURE IF EXISTS sp_check_customer_service_by_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_customer_service_by_id(IN p_id INT, IN p_customer_id INT)
BEGIN
    SELECT id FROM customer_service WHERE id = p_id AND customer_id = p_customer_id;
END //

DROP PROCEDURE IF EXISTS sp_check_service_number_duplicate_exclude //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_service_number_duplicate_exclude(IN p_customer_id INT, IN p_service_number VARCHAR(255), IN p_exclude_id INT)
BEGIN
    SELECT id FROM customer_service WHERE customer_id = p_customer_id AND service_number = p_service_number AND id <> p_exclude_id;
END //

DROP PROCEDURE IF EXISTS sp_check_customer_contact_by_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_customer_contact_by_id(IN p_id INT, IN p_customer_id INT)
BEGIN
    SELECT id FROM customer_contact WHERE id = p_id AND customer_id = p_customer_id;
END //

DROP PROCEDURE IF EXISTS sp_get_latest_customer_upload //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_get_latest_customer_upload(IN p_customer_id INT)
BEGIN
    SELECT upload_ppa, upload_share_transfer_form_certificate, upload_share_certificate,
           pledge_agreement, share_holding_agreement
    FROM customer_uploads
    WHERE customer_id = p_customer_id
    ORDER BY id DESC
    LIMIT 1;
END //

-- =============================================
-- UTILITY & SEEDING
-- =============================================

DROP PROCEDURE IF EXISTS sp_get_last_insert_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_get_last_insert_id()
BEGIN
    SELECT LAST_INSERT_ID() AS id;
END //

DROP PROCEDURE IF EXISTS sp_seed_get_customer //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_seed_get_customer(IN p_name VARCHAR(255))
BEGIN
    SELECT id FROM masters.master_customers WHERE customer_name = p_name AND status = '1' LIMIT 1;
END //

DROP PROCEDURE IF EXISTS sp_seed_insert_customer //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_seed_insert_customer(IN p_name VARCHAR(255), IN p_user_id INT)
BEGIN
    INSERT INTO masters.master_customers (customer_name, status, created_at, created_by, modified_at, modified_by) 
    VALUES (p_name, '1', NOW(), p_user_id, NOW(), p_user_id);
    SELECT LAST_INSERT_ID();
END //

DROP PROCEDURE IF EXISTS sp_seed_get_service //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_seed_get_service(IN p_cust_id INT, IN p_ser_no VARCHAR(255))
BEGIN
    SELECT id FROM masters.customer_service WHERE customer_id = p_cust_id AND service_number = p_ser_no AND status = '1' LIMIT 1;
END //

DROP PROCEDURE IF EXISTS sp_seed_insert_service //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_seed_insert_service(IN p_cust_id INT, IN p_ser_no VARCHAR(255), IN p_user_id INT)
BEGIN
    INSERT INTO masters.customer_service (customer_id, service_number, status, created_at, created_by, modified_at, modified_by) 
    VALUES (p_cust_id, p_ser_no, '1', NOW(), p_user_id, NOW(), p_user_id);
    SELECT LAST_INSERT_ID();
END //

DELIMITER ;

-- =============================================
-- DATABASE: windmill
-- =============================================
USE windmill //

-- EB BILL ROUTER
DROP PROCEDURE IF EXISTS sp_check_eb_bill_duplicate //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_eb_bill_duplicate(IN p_customer_id INT, IN p_sc_id INT, IN p_year INT, IN p_month INT)
BEGIN
    SELECT id FROM eb_bill WHERE customer_id = p_customer_id AND sc_id = p_sc_id AND bill_year = p_year AND bill_month = p_month LIMIT 1;
END //

DROP PROCEDURE IF EXISTS sp_submit_eb_bill //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_submit_eb_bill(IN p_header_id INT)
BEGIN
    UPDATE eb_bill SET is_submitted = 1 WHERE id = p_header_id;
END //

DROP PROCEDURE IF EXISTS sp_clear_eb_bill_data //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_clear_eb_bill_data(IN p_header_id INT)
BEGIN
    DELETE FROM eb_bill_details WHERE eb_bill_header_id = p_header_id;
    DELETE FROM eb_bill_adjustment_charges WHERE eb_bill_header_id = p_header_id;
    DELETE FROM actual WHERE client_eb_id = p_header_id;
END //

DROP PROCEDURE IF EXISTS sp_get_customer_name_by_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_get_customer_name_by_id(IN p_id INT)
BEGIN
    SELECT customer_name FROM masters.master_customers WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS sp_get_service_number_by_id //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_get_service_number_by_id(IN p_id INT)
BEGIN
    SELECT service_number FROM masters.customer_service WHERE id = p_id;
END //

DROP PROCEDURE IF EXISTS sp_check_eb_bill_exists //
CREATE DEFINER=`root`@`localhost` PROCEDURE sp_check_eb_bill_exists(IN p_id INT)
BEGIN
    SELECT id FROM eb_bill WHERE id = p_id;
END //


