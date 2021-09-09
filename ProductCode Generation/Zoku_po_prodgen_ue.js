/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(["N/search", "N/transaction", "N/runtime", "N/record", "N/email"], /**
 * @param {search} search
 * @param {transaction} transaction
 */ function (search, transaction, runtime, record, email) {
  /**
   * Function definition to be triggered before record is loaded.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.newRecord - New record
   * @param {string} scriptContext.type - Trigger type
   * @param {Form} scriptContext.form - Current form
   * @Since 2015.2
   */
  function beforeLoad(scriptContext) {
    //TODO - Limit the button to show only where the showing of the button is applicable
    try {
      scriptContext.form.addButton({
        id: "custpage_generate",
        label: "Generate Product Code",
        functionName: "generateFlow",
      });
      scriptContext.form.clientScriptModulePath =
        "SuiteScripts/Zoku_po_prodgen_cs.js";
    } catch (e) {
      log.error("Error occured on beforeLoad", e);
    }
  }

  /**
   * Function definition to be triggered before record is loaded.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.newRecord - New record
   * @param {Record} scriptContext.oldRecord - Old record
   * @param {string} scriptContext.type - Trigger type
   * @Since 2015.2
   */
  function beforeSubmit(scriptContext) {}

  return {
    beforeLoad: beforeLoad,
    // beforeSubmit: beforeSubmit,
  };
});
