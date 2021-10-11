/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/search", "N/ui/dialog"], /**
 * @param {runtime} runtime
 * @param {search} search
 * @param {dialog} dialog
 */ function (runtime, search, dialog) {
  /**
   * Validation function to be executed when record is saved.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @returns {boolean} Return true if record is valid
   *
   * @since 2015.2
   */
  function saveRecord(scriptContext) {
    try {
      log.debug("Context", scriptContext.currentRecord.id);
      //Check if the record is in 'edit' mode. Can do this by checking if there's an ID
      if (scriptContext.currentRecord.id) {
        var poRec = scriptContext.currentRecord;
        var poId = poRec.getValue({ fieldId: "id" });

        //Check if there are connected Product codes generated for this transaction
        if (
          poRec.getValue({ fieldId: "custbody_zoku_backend_status" }) == "2"
        ) {
          alert(
            "The system is still processing this transaction for the Product Code Generation, and therefore cannot be edited.\n\nPlease wait until the system finishes processing before modifying the record."
          );
          return false;
        } else if (transactionSearch(poId)) {
          var confirmDialog = confirm(
            "The system has detected that there are potential Product Codes generated for this transaction record.\n\nShould you wish to proceed, any removed Serial Codes will also inactivate the associated Product Codes.\n\nUser-input Serial Codes for applicable Item records will also be automatically removed.\n\nProceed saving the record anyways?"
          );
          if (confirmDialog != true) {
            return false;
          }
        }
      }
      return true;
    } catch (e) {
      log.error("Error occured", e);
    }
  }

  //Load the transaction record
  function transactionSearch(poId) {
    var tranSearch = search.create({
      type: "transaction",
      filters: [
        ["internalid", "anyof", poId],
        "AND",
        ["mainline", "is", "F"],
        "AND",
        ["item.type", "anyof", "InvtPart"],
        "AND",
        ["item.isserialitem", "is", "T"],
        "AND",
        ["formulatext: {item.custitem_zoku_prodcodetype}", "isnotempty", ""],
      ],
      columns: [search.createColumn({ name: "line" })],
    });
    return tranSearch.runPaged().count;
  }

  return {
    saveRecord: saveRecord,
  };
});
