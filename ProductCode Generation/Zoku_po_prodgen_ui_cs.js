/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/search", "N/ui/dialog", "N/record"], /**
 * @param {runtime} runtime
 * @param {search} search
 * @param {dialog} dialog
 */ function (runtime, search, dialog, record) {
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
      if (scriptContext.mode !== "edit") {
        var poRec = scriptContext.currentRecord;

        //Check if there are connected Product codes generated for this transaction
        var transactionSearchObj = transactionSearch(
          poRec.getValue({ fieldId: "id" })
        );
        var searchResultCount = transactionSearchObj.runPaged().count;

        if (searchResultCount) {
          var confirmDialog = confirm(
            "The system has detected that there are potential Product Codes generated for this transaction record. Should you wish to proceed, any removed Serial Codes will also be reflected on the Product Codes. Please confirm. Proceed saving the record?"
          );
          if (confirmDialog == true) {
            return true;
          } else {
            return false;
          }
        } else {
          //Passed initial checks, so the system can proceed with the changes
          return true;
        }
      }
    } catch (e) {
      log.error("Error occured", e);
    }
  }

  function transactionSearch(poId) {
    return search.create({
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
  }

  return {
    saveRecord: saveRecord,
  };
});
