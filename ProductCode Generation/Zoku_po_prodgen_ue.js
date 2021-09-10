/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([
  "N/search",
  "N/transaction",
  "N/runtime",
  "N/record",
  "N/email",
  "N/ui/message",
], /**
 * @param {search} search
 * @param {transaction} transaction
 */ function (search, transaction, runtime, record, email, message) {
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
      if (scriptContext.type == scriptContext.UserEventType.VIEW) {
        //Use the local script saved search
        var poRec = scriptContext.newRecord;
        var transactionSearchObj = search.create({
          type: "transaction",
          filters: [
            ["internalid", "anyof", poRec.getValue({ fieldId: "id" })],
            "AND",
            ["mainline", "is", "F"],
            "AND",
            ["item.type", "anyof", "InvtPart"],
            "AND",
            ["item.isserialitem", "is", "T"],
            "AND",
            [
              "formulatext: {item.custitem_zoku_prodcodetype}",
              "isnotempty",
              "",
            ],
          ],
          columns: [search.createColumn({ name: "line", label: "Line ID" })],
        });
        var searchResultCount = transactionSearchObj.runPaged().count;

        //Only display the button if there's applicable items where this should be displayed.
        if (searchResultCount > 0) {
          scriptContext.form.addButton({
            id: "custpage_generate",
            label: "Generate Product Code",
            functionName: "generateFlow",
          });
          scriptContext.form.clientScriptModulePath =
            "SuiteScripts/Zoku_po_prodgen_cs.js";

          //Show not yet created banenr
          if (
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) ==
              "1" ||
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) == ""
          ) {
            scriptContext.form.addPageInitMessage({
              type: message.Type.INFORMATION,
              title: "The Product Codes are not yet created for this order",
              message:
                "Please finalize the transaction and click 'Generate' to update the Product Codes once finalized.",
            });
          }
          //Show incomplete banner
          else if (
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) == "2"
          ) {
            scriptContext.form.addPageInitMessage({
              type: message.Type.INFORMATION,
              title: "This Purchase Order has incomplete Product Codes",
              message:
                "The Product Codes for the serialized item is incomplete. Please finalize the transaction and click 'Generate' to update the Product Codes accordingly.",
            });
          }
          //Show generated banner
          else if (
            poRec.getValue({ fieldId: "custbody_zoku_codegen_status" }) == "3"
          ) {
            scriptContext.form.addPageInitMessage({
              type: message.Type.CONFIRMATION,
              title:
                "This Product Codes have been generated for this transaction",
              message: "The Product Codes are all generated for this item.",
            });
          }
        }
      }
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
  function beforeSubmit(scriptContext) {
    try {
      if (scriptContext.type == scriptContext.UserEventType.EDIT) {
        var poRec = scriptContext.newRecord;
        var itemLineId = new Array();
        var itemLine = -1;

        //Check if there are connected Product codes generated for this transaction
        var transactionSearchObj = search.create({
          type: "transaction",
          filters: [
            ["internalid", "anyof", poRec.getValue({ fieldId: "id" })],
            "AND",
            ["mainline", "is", "F"],
            "AND",
            ["item.type", "anyof", "InvtPart"],
            "AND",
            ["item.isserialitem", "is", "T"],
            "AND",
            [
              "formulatext: {item.custitem_zoku_prodcodetype}",
              "isnotempty",
              "",
            ],
          ],
          columns: [search.createColumn({ name: "line", label: "Line ID" })],
        });
        var searchResultCount = transactionSearchObj.runPaged().count;
        transactionSearchObj.run().each(function (result) {
          itemLineId.push(result.getValue({ name: "line" }));
          return true;
        });

        //If there's lines that fit the criteria, proceed with checking to see if there's created Product Codes
        if (searchResultCount > 0) {
          var lineCount = poRec.getLineCount({ sublistId: "item" });
          for (var x = 0; x < lineCount; x++) {
            //Get the index of the line referenced from the search
            itemLine = itemLineId.indexOf(
              po.getSublistValue({
                sublistId: "item",
                fieldId: "line",
                line: x,
              })
            );

            //If it's greater than -1, meaning the line exists
            if (itemLine > -1) {
              //TODO
            }
          }
        }
      }
    } catch (e) {
      log.error("Error occured on beforeSubmit", e);
    }
  }

  return {
    beforeLoad: beforeLoad,
    beforeSubmit: beforeSubmit,
  };
});
