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
      if (scriptContext.mode !== "edit") {
        var poRec = scriptContext.currentRecord;
        var poId = poRec.getValue({ fieldId: "id" });

        //Check if there are connected Product codes generated for this transaction
        if (transactionSearch(poId)) {
          var confirmDialog = confirm(
            "The system has detected that there are potential Product Codes generated for this transaction record.\n\nShould you wish to proceed, any removed Serial Codes will also inactivate the associated Product Codes.\n\nProceed saving the record anyways?"
          );
          if (confirmDialog == true) {
            //Check if the item fits the criteria of the serial codes automatic generation
            var lineCount = poRec.getLineCount({ sublistId: "item" });
            var invDetail;
            var invDetailCount = 0;
            var invDetailSerial = "";
            var itemId = "";
            for (var x = 0; x < lineCount; x++) {
              //Select new line
              poRec.selectLine({ sublistId: "item", line: x });

              itemId = poRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "item",
              });

              //If a search result comes back, this means that the item fits the description
              if (checkSearch(itemId) > 0) {
                //Check the subrecord to see if there's user-entered PO values
                //We only check user-entered. The system should still allow missing values, as the system will generate later on
                invDetail = poRec.getCurrentSublistSubrecord({
                  sublistId: "item",
                  fieldId: "inventorydetail",
                });
                invDetailCount = invDetail.getLineCount({
                  sublistId: "inventoryassignment",
                });
                for (var y = 0; y < invDetailCount; y++) {
                  //Select the subrecord sublist
                  invDetail.selectLine({
                    sublistId: "inventoryassignment",
                    line: y,
                  });

                  invDetailSerial = invDetail.getCurrentSublistValue({
                    sublistId: "inventoryassignment",
                    fieldId: "receiptinventorynumber",
                  });

                  //If no results are returned, this is user-entered. Flag this.
                  if (confirmSerialCodes(poId, itemId, invDetailSerial) == 0) {
                    alert(
                      "The system detected a User-entered Serial Code.\nPlease remove the serial code to proceed saving the transaction record."
                    );
                    //Don't let the record save.
                    return false;
                  }
                }
              }
            }

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

  //Check if the serial code does not exist on the item subrecord
  function confirmSerialCodes(poId, itemId, serialNum) {
    var serialCodeSearch = search.create({
      type: "customrecord_zoku_prodcode_custrec",
      filters: [
        ["custrecord_zoku_source", "anyof", poId],
        "AND",
        ["custrecord_zoku_item", "anyof", itemId],
        "AND",
        ["custrecord_zoku_serialnumber", "is", serialNum],
      ],
      columns: [search.createColumn({ name: "id" })],
    });

    return serialCodeSearch.runPaged().count;
  }

  //Check if the item record fits the criteria for checking
  function checkSearch(itemId) {
    var serialItemSearch = search.create({
      type: "serializedinventoryitem",
      filters: [
        ["internalid", "anyof", itemId],
        "AND",
        ["type", "anyof", "InvtPart"],
        "AND",
        ["isserialitem", "is", "T"],
        "AND",
        ["custitem_zoku_prodcodetype", "noneof", "@NONE@"],
      ],
      columns: [search.createColumn({ name: "internalid" })],
    });
    return serialItemSearch.runPaged().count;
  }

  return {
    saveRecord: saveRecord,
  };
});
