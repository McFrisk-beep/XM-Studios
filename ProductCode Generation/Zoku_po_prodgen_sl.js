/**
 *@NApiVersion 2.x
 *@NScriptType Suitelet
 */
define(["N/task"], function (task) {
  function onRequest(context) {
    try {
      if (context.request.method == "GET") {
        var mapReduceTask = task.create({
          taskType: task.TaskType.MAP_REDUCE,
          scriptId: 400,
          //deploymentId: "customdeploy_zoku_bgprocess",
          params: {
            custscript_zoku_poid: context.request.parameters.internalid,
          },
        });
        mapReduceTask.submit();

        log.debug("Triggered from the Client script");
      }
    } catch (e) {
      log.error("Error occurred", e);
    }
  }

  return {
    onRequest: onRequest,
  };
});
